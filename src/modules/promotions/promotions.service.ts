import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from '../../database/prisma.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  ExecuteClassPromotionDto,
  ExecuteSchoolRolloverDto,
  StudentPromotionDecisionDto,
  TeacherConfirmPromotionDto,
} from './dto/promotions.dto.js';
import {
  findMatchingTargetClass,
  resolveClassProgression,
  suggestNextSessionName,
} from './promotion-ladder.util.js';

interface StudentAnnualComputation {
  annualAverage: number | null;
  hasGrades: boolean;
  termsCount: number;
  termBreakdown: Array<{ termId: string; termName: string; average: number }>;
  autoDecision: 'PROMOTED' | 'ON_TRIAL' | 'REPEATED' | 'GRADUATED';
}

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private isTertiaryType(institutionType?: string | null): boolean {
    const upper = String(institutionType || '').toUpperCase();
    return ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE_OF_EDUCATION', 'TERTIARY'].includes(upper);
  }

  /**
   * Computes annual averages for a list of students in a single batched round-trip (zero N+1 queries).
   * Uses TerminalReportCard.overallAverage first, falling back to StudentSubjectGrade.totalScore average.
   */
  private async computeStudentAnnualMetrics(
    schoolId: string,
    studentIds: string[],
    sessionTerms: Array<{ id: string; name: string }>,
    passMarkPercent: number,
    trialMarkPercent: number,
    isGraduatingClassMap: Map<string, boolean>,
    studentClassIdMap: Map<string, string | null>,
  ): Promise<Map<string, StudentAnnualComputation>> {
    const result = new Map<string, StudentAnnualComputation>();
    if (studentIds.length === 0) return result;

    const termIds = sessionTerms.map((t) => t.id);
    const termNameMap = new Map(sessionTerms.map((t) => [t.id, t.name]));

    const [reportCards, subjectGrades] =
      termIds.length > 0
        ? await Promise.all([
            this.prisma.terminalReportCard.findMany({
              where: {
                schoolId,
                studentId: { in: studentIds },
                termId: { in: termIds },
              },
              select: {
                studentId: true,
                termId: true,
                overallAverage: true,
              },
            }),
            this.prisma.studentSubjectGrade.findMany({
              where: {
                schoolId,
                studentId: { in: studentIds },
                termId: { in: termIds },
              },
              select: {
                studentId: true,
                termId: true,
                totalScore: true,
              },
            }),
          ])
        : [[], []];

    // Group report cards by studentId -> termId -> overallAverage
    const reportMap = new Map<string, Map<string, number>>();
    for (const rc of reportCards) {
      if (!reportMap.has(rc.studentId)) reportMap.set(rc.studentId, new Map());
      reportMap.get(rc.studentId)!.set(rc.termId, Number(rc.overallAverage) || 0);
    }

    // Group raw subject grades by studentId -> termId -> [scores]
    const gradeMap = new Map<string, Map<string, number[]>>();
    for (const g of subjectGrades) {
      if (!gradeMap.has(g.studentId)) gradeMap.set(g.studentId, new Map());
      const tMap = gradeMap.get(g.studentId)!;
      if (!tMap.has(g.termId)) tMap.set(g.termId, []);
      tMap.get(g.termId)!.push(Number(g.totalScore) || 0);
    }

    for (const sid of studentIds) {
      const sReports = reportMap.get(sid);
      const sGrades = gradeMap.get(sid);
      const termBreakdown: Array<{ termId: string; termName: string; average: number }> = [];

      for (const term of sessionTerms) {
        if (sReports?.has(term.id)) {
          termBreakdown.push({
            termId: term.id,
            termName: termNameMap.get(term.id) || term.name,
            average: Number(sReports.get(term.id)!.toFixed(1)),
          });
        } else if (sGrades?.has(term.id)) {
          const scores = sGrades.get(term.id)!;
          if (scores.length > 0) {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            termBreakdown.push({
              termId: term.id,
              termName: termNameMap.get(term.id) || term.name,
              average: Number(avg.toFixed(1)),
            });
          }
        }
      }

      const hasGrades = termBreakdown.length > 0;
      const annualAverage = hasGrades
        ? Number(
            (
              termBreakdown.reduce((sum, item) => sum + item.average, 0) / termBreakdown.length
            ).toFixed(1),
          )
        : null;

      const clsId = studentClassIdMap.get(sid) || null;
      const isGraduating = clsId ? !!isGraduatingClassMap.get(clsId) : false;

      let autoDecision: 'PROMOTED' | 'ON_TRIAL' | 'REPEATED' | 'GRADUATED';
      if (!hasGrades || annualAverage === null) {
        // Zero-friction default: classes without entered scores (e.g. Creche/Nursery or new school) pre-tag as Promoted/Graduated
        autoDecision = isGraduating ? 'GRADUATED' : 'PROMOTED';
      } else if (annualAverage >= passMarkPercent) {
        autoDecision = isGraduating ? 'GRADUATED' : 'PROMOTED';
      } else if (annualAverage >= trialMarkPercent) {
        autoDecision = isGraduating ? 'GRADUATED' : 'ON_TRIAL';
      } else {
        autoDecision = 'REPEATED';
      }

      result.set(sid, {
        annualAverage,
        hasGrades,
        termsCount: termBreakdown.length,
        termBreakdown,
        autoDecision,
      });
    }

    return result;
  }

  /**
   * Resolves all active (non-graduated) students in a school and maps each to their primary classId.
   */
  private async fetchActiveSchoolStudents(schoolId: string, classIdFilter?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        schoolId,
        role: 'STUDENT',
        ...(classIdFilter
          ? {
              OR: [
                { classId: classIdFilter },
                { studentProfile: { classId: classIdFilter } },
                { classEnrollments: { some: { classId: classIdFilter } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        loginId: true,
        avatarUrl: true,
        classId: true,
        studentProfile: {
          select: {
            id: true,
            classId: true,
            level: true,
            matricOrAdmissionNo: true,
            academicStatus: true,
            departmentId: true,
            department: { select: { id: true, name: true, code: true } },
          },
        },
        classEnrollments: {
          select: { classId: true, enrolledAt: true },
          orderBy: { enrolledAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return users
      .filter((u) => (u.studentProfile?.academicStatus || 'ACTIVE') !== 'GRADUATED')
      .map((u) => {
        const resolvedClassId =
          u.studentProfile?.classId ||
          u.classId ||
          u.classEnrollments?.[0]?.classId ||
          null;
        return {
          ...u,
          resolvedClassId,
        };
      });
  }

  // ============================================================================
  // 1. OVERVIEW: ALL CLASSES SORTED TOP-DOWN WITH LADDER MAPPING & AUTO-TAGS
  // ============================================================================

  async getPromotionOverview(
    schoolId: string,
    actorId: string,
    actorRole: string,
    query?: {
      sessionId?: string;
      passMarkPercent?: number;
      trialMarkPercent?: number;
    },
  ) {
    const passMark = Number.isFinite(Number(query?.passMarkPercent))
      ? Number(query!.passMarkPercent)
      : 50;
    const trialMark = Number.isFinite(Number(query?.trialMarkPercent))
      ? Number(query!.trialMarkPercent)
      : 40;

    const [
      school,
      sessions,
      allClasses,
      activeStudents,
      graduatedCount,
      reviews,
      unpaidInvoiceGroups,
      recentBatches,
      teacherProfile,
    ] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, schoolCode: true, institutionType: true },
      }),
      this.prisma.academicSession.findMany({
        where: { schoolId },
        include: { terms: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        select: {
          id: true,
          name: true,
          levelCode: true,
          departmentId: true,
          formTeacherId: true,
          department: { select: { id: true, name: true, code: true } },
          _count: { select: { subjects: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.fetchActiveSchoolStudents(schoolId),
      this.prisma.studentProfile.count({
        where: { schoolId, academicStatus: 'GRADUATED' },
      }),
      this.prisma.promotionClassReview.findMany({
        where: { schoolId },
        include: {
          reviewedBy: { select: { id: true, fullName: true, role: true } },
        },
      }),
      this.prisma.studentInvoice.groupBy({
        by: ['studentId'],
        where: {
          schoolId,
          status: { not: 'PAID' },
          balanceAmountKobo: { gt: 0 },
        },
        _sum: { balanceAmountKobo: true },
        _count: { id: true },
      }),
      this.prisma.promotionBatch.findMany({
        where: { schoolId },
        include: {
          executedBy: { select: { id: true, fullName: true } },
          rolledBackBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      actorRole === 'TEACHER'
        ? this.prisma.teacherProfile.findFirst({
            where: { schoolId, userId: actorId },
            select: {
              id: true,
              assignedClasses: { select: { id: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    if (!school) throw new NotFoundException('Institution not found');

    const isTertiary = this.isTertiaryType(school.institutionType);
    const activeSession =
      (query?.sessionId ? sessions.find((s) => s.id === query.sessionId) : null) ||
      sessions.find((s) => s.isCurrent) ||
      sessions[0] ||
      null;

    const allClassNames = allClasses.map((c) => c.name);
    const progressionMap = new Map(
      allClasses.map((cls) => [
        cls.id,
        resolveClassProgression(cls.name, allClassNames, isTertiary),
      ]),
    );
    const isGraduatingClassMap = new Map(
      allClasses.map((cls) => [cls.id, !!progressionMap.get(cls.id)?.isGraduatingClass]),
    );

    const reviewMap = new Map(reviews.map((r) => [r.classId, r]));
    const arrearsMap = new Map(
      unpaidInvoiceGroups.map((g) => [
        g.studentId,
        {
          totalKobo: Number(g._sum.balanceAmountKobo) || 0,
          count: g._count.id || 0,
        },
      ]),
    );

    // Filter classes for teachers (only their Form Classes or assigned classes)
    const teacherClassIds = new Set<string>();
    if (actorRole === 'TEACHER') {
      for (const cls of allClasses) {
        if (cls.formTeacherId === actorId) teacherClassIds.add(cls.id);
      }
      for (const ac of teacherProfile?.assignedClasses || []) {
        teacherClassIds.add(ac.id);
      }
    }

    const visibleClasses =
      actorRole === 'TEACHER'
        ? allClasses.filter((c) => teacherClassIds.has(c.id))
        : allClasses;

    const studentClassIdMap = new Map(activeStudents.map((s) => [s.id, s.resolvedClassId]));
    const annualMetrics = await this.computeStudentAnnualMetrics(
      schoolId,
      activeStudents.map((s) => s.id),
      activeSession?.terms || [],
      passMark,
      trialMark,
      isGraduatingClassMap,
      studentClassIdMap,
    );

    // Group students by classId
    const studentsByClass = new Map<string, typeof activeStudents>();
    for (const s of activeStudents) {
      if (!s.resolvedClassId) continue;
      if (!studentsByClass.has(s.resolvedClassId)) studentsByClass.set(s.resolvedClassId, []);
      studentsByClass.get(s.resolvedClassId)!.push(s);
    }

    // Build top-down sorted class cards
    const classCards = visibleClasses
      .map((cls) => {
        const prog = progressionMap.get(cls.id)!;
        const targetClass = findMatchingTargetClass(allClasses, prog.nextClassName, cls.departmentId);
        const roster = studentsByClass.get(cls.id) || [];
        const review = reviewMap.get(cls.id) || null;
        const teacherExceptions = (review?.exceptionsJson as Record<string, any>) || {};

        let promotedCount = 0;
        let onTrialCount = 0;
        let repeatCount = 0;
        let graduatedStudentsCount = 0;
        let arrearsStudentsCount = 0;
        let totalArrearsKobo = 0;

        for (const student of roster) {
          const metric = annualMetrics.get(student.id);
          const override = teacherExceptions[student.id];
          const effectiveDecision =
            override?.decision || metric?.autoDecision || (prog.isGraduatingClass ? 'GRADUATED' : 'PROMOTED');

          if (effectiveDecision === 'GRADUATED') graduatedStudentsCount++;
          else if (effectiveDecision === 'ON_TRIAL') onTrialCount++;
          else if (effectiveDecision === 'REPEATED') repeatCount++;
          else promotedCount++;

          const arr = arrearsMap.get(student.id);
          if (arr && arr.totalKobo > 0) {
            arrearsStudentsCount++;
            totalArrearsKobo += arr.totalKobo;
          }
        }

        return {
          classId: cls.id,
          className: cls.name,
          levelCode: cls.levelCode,
          departmentName: cls.department?.name || null,
          subjectsCount: cls._count.subjects,
          studentCount: roster.length,
          ladderRank: prog.ladderRank,
          stageLabel: prog.stageLabel,
          isGraduatingClass: prog.isGraduatingClass,
          suggestedNextClassName: prog.nextClassName,
          suggestedNextLevelCode: prog.nextLevelCode,
          existingTargetClass: targetClass
            ? { id: targetClass.id, name: targetClass.name }
            : null,
          willAutoCreateTarget: !prog.isGraduatingClass && !!prog.nextClassName && !targetClass,
          summary: {
            promotedCount,
            onTrialCount,
            repeatCount,
            graduatedCount: graduatedStudentsCount,
            arrearsStudentsCount,
            totalArrearsKobo,
          },
          teacherReview: review
            ? {
                confirmedAt: review.confirmedAt,
                reviewedByName: review.reviewedBy?.fullName || 'Form Teacher',
                exceptionsCount: Object.keys(teacherExceptions).length,
              }
            : null,
        };
      })
      .sort((a, b) => b.ladderRank - a.ladderRank || a.className.localeCompare(b.className));

    const now = new Date();
    const formattedBatches = recentBatches.map((b) => ({
      ...b,
      canUndo: b.status === 'EXECUTED' && !!b.canUndoUntil && b.canUndoUntil > now,
    }));

    return {
      school: {
        ...school,
        isTertiary,
      },
      activeSession: activeSession
        ? {
            id: activeSession.id,
            name: activeSession.name,
            isCurrent: activeSession.isCurrent,
            termsCount: activeSession.terms.length,
          }
        : null,
      suggestedNextSessionName: suggestNextSessionName(activeSession?.name),
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        isCurrent: s.isCurrent,
        termsCount: s.terms.length,
      })),
      passMarkPercent: passMark,
      trialMarkPercent: trialMark,
      totals: {
        activeStudentsCount: activeStudents.length,
        graduatedAlumniCount: graduatedCount,
        classesCount: classCards.length,
        teacherConfirmedClassesCount: classCards.filter((c) => !!c.teacherReview).length,
      },
      allDestinationClasses: allClasses.map((c) => ({
        id: c.id,
        name: c.name,
        levelCode: c.levelCode,
      })),
      classes: classCards,
      recentBatches: formattedBatches,
    };
  }

  // ============================================================================
  // 2. CLASS EXCEPTION-ONLY PREVIEW (PRE-TAGGED STUDENT ROSTER)
  // ============================================================================

  async getClassPromotionPreview(
    schoolId: string,
    classId: string,
    query?: {
      sessionId?: string;
      passMarkPercent?: number;
      trialMarkPercent?: number;
    },
  ) {
    const passMark = Number.isFinite(Number(query?.passMarkPercent))
      ? Number(query!.passMarkPercent)
      : 50;
    const trialMark = Number.isFinite(Number(query?.trialMarkPercent))
      ? Number(query!.trialMarkPercent)
      : 40;

    const [school, allClasses, sessions, roster, review] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, institutionType: true },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        select: { id: true, name: true, levelCode: true, departmentId: true, formTeacherId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.academicSession.findMany({
        where: { schoolId },
        include: { terms: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
      }),
      this.fetchActiveSchoolStudents(schoolId, classId),
      this.prisma.promotionClassReview.findFirst({
        where: { schoolId, classId },
        include: { reviewedBy: { select: { id: true, fullName: true } } },
      }),
    ]);

    const sourceClass = allClasses.find((c) => c.id === classId);
    if (!sourceClass || !school) {
      throw new NotFoundException('Class not found in this institution.');
    }

    const isTertiary = this.isTertiaryType(school.institutionType);
    const prog = resolveClassProgression(
      sourceClass.name,
      allClasses.map((c) => c.name),
      isTertiary,
    );
    const defaultTargetClass = findMatchingTargetClass(
      allClasses,
      prog.nextClassName,
      sourceClass.departmentId,
    );

    const activeSession =
      (query?.sessionId ? sessions.find((s) => s.id === query.sessionId) : null) ||
      sessions.find((s) => s.isCurrent) ||
      sessions[0] ||
      null;

    const studentIds = roster.map((s) => s.id);
    const [annualMetrics, unpaidInvoiceGroups] = await Promise.all([
      this.computeStudentAnnualMetrics(
        schoolId,
        studentIds,
        activeSession?.terms || [],
        passMark,
        trialMark,
        new Map([[classId, prog.isGraduatingClass]]),
        new Map(studentIds.map((id) => [id, classId])),
      ),
      studentIds.length > 0
        ? this.prisma.studentInvoice.groupBy({
            by: ['studentId'],
            where: {
              schoolId,
              studentId: { in: studentIds },
              status: { not: 'PAID' },
              balanceAmountKobo: { gt: 0 },
            },
            _sum: { balanceAmountKobo: true },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const arrearsMap = new Map(
      unpaidInvoiceGroups.map((g) => [
        g.studentId,
        {
          totalKobo: Number(g._sum.balanceAmountKobo) || 0,
          count: g._count.id || 0,
        },
      ]),
    );
    const teacherExceptions = (review?.exceptionsJson as Record<string, any>) || {};

    const students = roster.map((student) => {
      const metric = annualMetrics.get(student.id);
      const teacherOverride = teacherExceptions[student.id] || null;
      const autoDecision =
        metric?.autoDecision || (prog.isGraduatingClass ? 'GRADUATED' : 'PROMOTED');
      const suggestedDecision = teacherOverride?.decision || autoDecision;
      const arr = arrearsMap.get(student.id);

      return {
        studentId: student.id,
        fullName: student.fullName || 'Student',
        loginId: student.studentProfile?.matricOrAdmissionNo || student.loginId || '',
        avatarUrl: student.avatarUrl,
        currentLevel: student.studentProfile?.level || sourceClass.levelCode || sourceClass.name,
        departmentName: student.studentProfile?.department?.name || null,
        annualAverage: metric?.annualAverage ?? null,
        hasGrades: metric?.hasGrades ?? false,
        termBreakdown: metric?.termBreakdown || [],
        autoDecision,
        suggestedDecision,
        teacherNote: teacherOverride?.note || null,
        overrideTargetClassId: teacherOverride?.targetClassId || null,
        unpaidArrearsKobo: arr?.totalKobo || 0,
        unpaidInvoicesCount: arr?.count || 0,
      };
    });

    return {
      sourceClass: {
        id: sourceClass.id,
        name: sourceClass.name,
        levelCode: sourceClass.levelCode,
        stageLabel: prog.stageLabel,
        isGraduatingClass: prog.isGraduatingClass,
      },
      defaultTarget: {
        classId: defaultTargetClass?.id || null,
        className: defaultTargetClass?.name || prog.nextClassName,
        levelCode: defaultTargetClass?.levelCode || prog.nextLevelCode,
        willAutoCreate: !prog.isGraduatingClass && !!prog.nextClassName && !defaultTargetClass,
      },
      session: activeSession ? { id: activeSession.id, name: activeSession.name } : null,
      passMarkPercent: passMark,
      trialMarkPercent: trialMark,
      teacherReview: review
        ? {
            confirmedAt: review.confirmedAt,
            reviewedByName: review.reviewedBy?.fullName || 'Form Teacher',
            exceptionsCount: Object.keys(teacherExceptions).length,
          }
        : null,
      availableTargetClasses: allClasses
        .filter((c) => c.id !== classId)
        .map((c) => ({ id: c.id, name: c.name, levelCode: c.levelCode })),
      students,
    };
  }

  // ============================================================================
  // 3. ZERO-STRESS FORM TEACHER 1-TAP CONFIRMATION & EXCEPTIONS
  // ============================================================================

  async confirmClassByTeacher(
    schoolId: string,
    classId: string,
    actorId: string,
    actorRole: string,
    dto: TeacherConfirmPromotionDto,
  ) {
    const cls = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
      select: { id: true, name: true, formTeacherId: true },
    });
    if (!cls) throw new NotFoundException('Class not found.');

    if (actorRole === 'TEACHER') {
      const teacherProfile = await this.prisma.teacherProfile.findFirst({
        where: { schoolId, userId: actorId },
        select: { id: true, assignedClasses: { where: { id: classId }, select: { id: true } } },
      });
      const isAuthorized =
        cls.formTeacherId === actorId || (teacherProfile?.assignedClasses?.length || 0) > 0;
      if (!isAuthorized) {
        throw new ForbiddenException(
          'Only the assigned Form Teacher or School Admin can confirm this class promotion list.',
        );
      }
    }

    const exceptionsMap: Record<string, any> = {};
    for (const ex of dto.exceptions || []) {
      exceptionsMap[ex.studentId] = {
        decision: ex.decision,
        targetClassId: ex.targetClassId || null,
        targetClassName: ex.targetClassName || null,
        note: ex.note?.trim() || null,
      };
    }

    const review = await this.prisma.promotionClassReview.upsert({
      where: { schoolId_classId: { schoolId, classId } },
      update: {
        sessionId: dto.sessionId || null,
        reviewedById: actorId,
        exceptionsJson: exceptionsMap,
        confirmedAt: new Date(),
      },
      create: {
        schoolId,
        classId,
        sessionId: dto.sessionId || null,
        reviewedById: actorId,
        exceptionsJson: exceptionsMap,
      },
      include: {
        reviewedBy: { select: { id: true, fullName: true } },
      },
    });

    // Notify School Admins that the Form Teacher has confirmed this class list
    try {
      const admins = await this.prisma.user.findMany({
        where: { schoolId, role: 'SCHOOL_ADMIN' },
        select: { id: true },
      });
      const exCount = Object.keys(exceptionsMap).length;
      for (const admin of admins) {
        void this.notifications.dispatchNotification({
          userId: admin.id,
          schoolId,
          title: `Promotion List Confirmed: ${cls.name} ✅`,
          body: `${review.reviewedBy?.fullName || 'Form Teacher'} confirmed the promotion list for ${cls.name}${exCount > 0 ? ` (${exCount} exception${exCount > 1 ? 's' : ''} flagged)` : ' (all eligible students ready)'}. Tap to approve in 1 click.`,
          category: 'SCHOOL',
          deepLink: '/schoolAdmin/promotions',
          dataJson: { classId: cls.id },
        });
      }
    } catch {
      // Non-blocking notification
    }

    return {
      success: true,
      classId: cls.id,
      className: cls.name,
      exceptionsCount: Object.keys(exceptionsMap).length,
      confirmedAt: review.confirmedAt,
    };
  }

  // ============================================================================
  // HELPER: AUTO-CREATE MISSING DESTINATION CLASS & CLONE SUBJECT SLOTS
  // ============================================================================

  private async ensureDestinationClass(
    tx: any,
    schoolId: string,
    sourceClass: {
      id: string;
      name: string;
      departmentId?: string | null;
      minAttendancePercent?: number;
    },
    targetClassName: string,
    nextLevelCode: string | null,
  ): Promise<{ id: string; name: string; levelCode: string | null; created: boolean }> {
    const cleanTarget = targetClassName.trim().replace(/\s+/g, ' ');
    const existing = await tx.schoolClass.findFirst({
      where: {
        schoolId,
        name: { equals: cleanTarget, mode: 'insensitive' },
      },
      select: { id: true, name: true, levelCode: true },
    });

    if (existing) {
      return { ...existing, created: false };
    }

    const inviteCode = `CLS-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString(36).slice(-3).toUpperCase()}`;
    const createdClass = await tx.schoolClass.create({
      data: {
        schoolId,
        name: cleanTarget,
        levelCode: nextLevelCode || cleanTarget,
        departmentId: sourceClass.departmentId || null,
        inviteCode,
        minAttendancePercent: sourceClass.minAttendancePercent ?? 75,
      },
      select: { id: true, name: true, levelCode: true },
    });

    // Clone standard subject slots from the source class so teachers have zero setup friction
    const sourceSubjects = await tx.schoolSubject.findMany({
      where: { schoolId, classId: sourceClass.id },
      select: {
        name: true,
        courseCode: true,
        creditUnits: true,
        departmentId: true,
        minAttendancePercent: true,
      },
    });

    if (sourceSubjects.length > 0) {
      await tx.schoolSubject.createMany({
        data: sourceSubjects.map((subj: any) => ({
          schoolId,
          classId: createdClass.id,
          departmentId: subj.departmentId || sourceClass.departmentId || null,
          name: subj.name,
          courseCode: subj.courseCode,
          creditUnits: subj.creditUnits,
          minAttendancePercent: subj.minAttendancePercent ?? 75.0,
        })),
      });
    }

    return { ...createdClass, created: true };
  }

  /**
   * Post-rollover finance integration: auto-issues invoices for any already-approved
   * fee structures targeting the destination classes, and records newly created invoice IDs
   * on the corresponding PromotionBatchEntry rows so Undo can cleanly remove unpaid new invoices.
   */
  private async issueNewClassInvoicesForBatch(
    schoolId: string,
    batchId: string,
    destinationClassIds: string[],
    studentIds: string[],
  ): Promise<number> {
    const uniqueClassIds = Array.from(new Set(destinationClassIds.filter(Boolean)));
    if (uniqueClassIds.length === 0 || studentIds.length === 0) return 0;

    const approvedFees = await this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        isPublished: true,
        approvalStatus: 'APPROVED',
        classId: { in: uniqueClassIds },
      },
      select: { id: true, classId: true },
    });

    if (approvedFees.length === 0) return 0;

    // Snapshot existing invoice IDs before generating so we know exact IDs added by this batch
    const preExisting = await this.prisma.studentInvoice.findMany({
      where: {
        schoolId,
        studentId: { in: studentIds },
        feeStructureId: { in: approvedFees.map((f) => f.id) },
      },
      select: { id: true },
    });
    const preExistingSet = new Set(preExisting.map((i) => i.id));

    let totalGenerated = 0;
    for (const fee of approvedFees) {
      try {
        totalGenerated += await this.financeService.generateInvoicesForFeeStructure(
          schoolId,
          fee.id,
        );
      } catch (err: any) {
        this.logger.warn(`Post-promotion invoice generation notice for fee ${fee.id}: ${err?.message}`);
      }
    }

    if (totalGenerated > 0) {
      const postInvoices = await this.prisma.studentInvoice.findMany({
        where: {
          schoolId,
          studentId: { in: studentIds },
          feeStructureId: { in: approvedFees.map((f) => f.id) },
        },
        select: { id: true, studentId: true },
      });

      const newByStudent = new Map<string, string[]>();
      for (const inv of postInvoices) {
        if (!preExistingSet.has(inv.id)) {
          if (!newByStudent.has(inv.studentId)) newByStudent.set(inv.studentId, []);
          newByStudent.get(inv.studentId)!.push(inv.id);
        }
      }

      const entries = await this.prisma.promotionBatchEntry.findMany({
        where: { batchId, studentId: { in: Array.from(newByStudent.keys()) } },
        select: { id: true, studentId: true },
      });

      await Promise.all([
        ...entries.map((e) =>
          this.prisma.promotionBatchEntry.update({
            where: { id: e.id },
            data: { createdInvoiceIds: newByStudent.get(e.studentId) || [] },
          }),
        ),
        this.prisma.promotionBatch.update({
          where: { id: batchId },
          data: { generatedInvoicesCount: totalGenerated },
        }),
      ]);
    }

    return totalGenerated;
  }

  // ============================================================================
  // 4. EXECUTE SINGLE-CLASS 1-CLICK PROMOTION (ATOMIC + 24H UNDO)
  // ============================================================================

  async executeClassPromotion(
    schoolId: string,
    actorId: string,
    actorRole: string,
    dto: ExecuteClassPromotionDto,
  ) {
    if (actorRole !== 'SCHOOL_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only School Administrators can execute student promotions.');
    }

    const preview = await this.getClassPromotionPreview(schoolId, dto.classId, {
      sessionId: dto.sessionId,
      passMarkPercent: dto.passMarkPercent,
      trialMarkPercent: dto.trialMarkPercent,
    });

    if (preview.students.length === 0) {
      throw new BadRequestException('There are no active students in this class to promote.');
    }

    const sourceClassFull = await this.prisma.schoolClass.findFirst({
      where: { id: dto.classId, schoolId },
      select: {
        id: true,
        name: true,
        levelCode: true,
        departmentId: true,
        minAttendancePercent: true,
      },
    });
    if (!sourceClassFull) throw new NotFoundException('Source class not found.');

    const overrideMap = new Map<string, StudentPromotionDecisionDto>(
      (dto.overrides || []).map((o) => [o.studentId, o]),
    );

    const allSchoolClasses = await this.prisma.schoolClass.findMany({
      where: { schoolId },
      select: { id: true, name: true, levelCode: true },
    });
    const classLookup = new Map(allSchoolClasses.map((c) => [c.id, c]));

    const autoCreate = dto.autoCreateTargetClass !== false;
    const forceGraduating = !!dto.markAsGraduating;

    // Resolve default destination info
    let defaultTargetClassId = dto.targetClassId || preview.defaultTarget.classId || null;
    const defaultTargetClassName =
      (defaultTargetClassId ? classLookup.get(defaultTargetClassId)?.name : null) ||
      dto.targetClassName?.trim() ||
      preview.defaultTarget.className ||
      null;

    if (!forceGraduating && !preview.sourceClass.isGraduatingClass && !defaultTargetClassId && !defaultTargetClassName) {
      throw new BadRequestException(
        'Please specify a destination class or mark this class as graduating.',
      );
    }

    const destinationClassIdsUsed = new Set<string>();
    const promotedStudentIdsForNotification: Array<{
      studentId: string;
      decision: string;
      toClassName: string | null;
    }> = [];

    const txResult = await this.prisma.$transaction(
      async (tx) => {
        let autoCreatedClassesCount = 0;

        // Auto-create primary destination class if needed
        if (
          !forceGraduating &&
          !defaultTargetClassId &&
          defaultTargetClassName &&
          autoCreate
        ) {
          const ensured = await this.ensureDestinationClass(
            tx,
            schoolId,
            sourceClassFull,
            defaultTargetClassName,
            preview.defaultTarget.levelCode,
          );
          defaultTargetClassId = ensured.id;
          classLookup.set(ensured.id, {
            id: ensured.id,
            name: ensured.name,
            levelCode: ensured.levelCode,
          });
          if (ensured.created) autoCreatedClassesCount++;
        }

        let promotedCount = 0;
        let repeatedCount = 0;
        let graduatedCount = 0;

        const batch = await tx.promotionBatch.create({
          data: {
            schoolId,
            fromSessionId: preview.session?.id || null,
            fromSessionName: preview.session?.name || 'Current Session',
            toSessionName:
              dto.toSessionName?.trim() || suggestNextSessionName(preview.session?.name),
            scopeType: 'SINGLE_CLASS',
            status: 'EXECUTED',
            passMarkPercent: preview.passMarkPercent,
            trialMarkPercent: preview.trialMarkPercent,
            executedById: actorId,
            canUndoUntil: dayjs().add(24, 'hour').toDate(),
            notes: dto.notes?.trim() || `1-Click Promotion: ${sourceClassFull.name}`,
          },
        });

        const entryRows: any[] = [];
        const enrollmentCreates: Array<{ classId: string; studentId: string }> = [];
        const groupedMoves = new Map<string, { studentIds: string[]; level: string }>();
        const graduatedIds: string[] = [];

        for (const student of preview.students) {
          const override = overrideMap.get(student.studentId);
          let decision: 'PROMOTED' | 'ON_TRIAL' | 'REPEATED' | 'GRADUATED' =
            override?.decision ||
            (forceGraduating
              ? student.suggestedDecision === 'REPEATED'
                ? 'REPEATED'
                : 'GRADUATED'
              : student.suggestedDecision);

          let toClassId: string | null = null;
          let toClassName: string | null = null;
          let toLevel: string | null = student.currentLevel;
          let toAcademicStatus = 'ACTIVE';

          if (decision === 'REPEATED') {
            repeatedCount++;
            toClassId = sourceClassFull.id;
            toClassName = sourceClassFull.name;
            toLevel = student.currentLevel;
          } else if (decision === 'GRADUATED') {
            graduatedCount++;
            toClassId = null;
            toClassName = 'Graduated Alumni';
            toLevel = 'ALUMNI';
            toAcademicStatus = 'GRADUATED';
            graduatedIds.push(student.studentId);
          } else {
            // PROMOTED or ON_TRIAL
            let resolvedDestId =
              override?.targetClassId || student.overrideTargetClassId || defaultTargetClassId;
            if (!resolvedDestId && override?.targetClassName && autoCreate) {
              const ensured = await this.ensureDestinationClass(
                tx,
                schoolId,
                sourceClassFull,
                override.targetClassName,
                null,
              );
              resolvedDestId = ensured.id;
              classLookup.set(ensured.id, {
                id: ensured.id,
                name: ensured.name,
                levelCode: ensured.levelCode,
              });
              if (ensured.created) autoCreatedClassesCount++;
            }

            if (!resolvedDestId) {
              // Fallback: if graduating class without a target, graduate
              decision = 'GRADUATED';
              graduatedCount++;
              toClassName = 'Graduated Alumni';
              toLevel = 'ALUMNI';
              toAcademicStatus = 'GRADUATED';
              graduatedIds.push(student.studentId);
            } else {
              promotedCount++;
              const destInfo = classLookup.get(resolvedDestId);
              toClassId = resolvedDestId;
              toClassName = destInfo?.name || defaultTargetClassName || 'Next Class';
              toLevel = destInfo?.levelCode || toClassName;
              destinationClassIdsUsed.add(resolvedDestId);

              if (!groupedMoves.has(resolvedDestId)) {
                groupedMoves.set(resolvedDestId, { studentIds: [], level: toLevel });
              }
              groupedMoves.get(resolvedDestId)!.studentIds.push(student.studentId);
              enrollmentCreates.push({ classId: resolvedDestId, studentId: student.studentId });
            }
          }

          entryRows.push({
            batchId: batch.id,
            studentId: student.studentId,
            fromClassId: sourceClassFull.id,
            fromClassName: sourceClassFull.name,
            fromLevel: student.currentLevel,
            fromAcademicStatus: 'ACTIVE',
            toClassId,
            toClassName,
            toLevel,
            toAcademicStatus,
            decision,
            annualAverage: student.annualAverage,
            unpaidArrearsKobo: student.unpaidArrearsKobo,
          });

          if (decision !== 'REPEATED') {
            promotedStudentIdsForNotification.push({
              studentId: student.studentId,
              decision,
              toClassName,
            });
          }
        }

        // Batch-execute student updates per target class (fast, minimal round-trips)
        for (const [destClassId, group] of groupedMoves.entries()) {
          await tx.user.updateMany({
            where: { id: { in: group.studentIds } },
            data: { classId: destClassId },
          });
          await tx.studentProfile.updateMany({
            where: { userId: { in: group.studentIds } },
            data: {
              classId: destClassId,
              level: group.level,
              academicStatus: 'ACTIVE',
              graduatedAt: null,
            },
          });
        }

        if (enrollmentCreates.length > 0) {
          await tx.classEnrollment.createMany({
            data: enrollmentCreates,
            skipDuplicates: true,
          });
        }

        if (graduatedIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: graduatedIds } },
            data: { classId: null },
          });
          await tx.studentProfile.updateMany({
            where: { userId: { in: graduatedIds } },
            data: {
              classId: null,
              level: 'ALUMNI',
              academicStatus: 'GRADUATED',
              graduatedAt: new Date(),
            },
          });
        }

        if (entryRows.length > 0) {
          await tx.promotionBatchEntry.createMany({ data: entryRows });
        }

        // Clear Form Teacher review flag for this class once promoted
        await tx.promotionClassReview.deleteMany({
          where: { schoolId, classId: sourceClassFull.id },
        });

        const updatedBatch = await tx.promotionBatch.update({
          where: { id: batch.id },
          data: {
            totalProcessed: entryRows.length,
            promotedCount,
            repeatedCount,
            graduatedCount,
            autoCreatedClassesCount,
          },
        });

        return updatedBatch;
      },
      { timeout: 25000 },
    );

    // Post-transaction: auto-issue approved new class fee invoices while keeping previous arrears intact
    let generatedInvoicesCount = 0;
    if (dto.autoIssueNewClassFees !== false && destinationClassIdsUsed.size > 0) {
      generatedInvoicesCount = await this.issueNewClassInvoicesForBatch(
        schoolId,
        txResult.id,
        Array.from(destinationClassIdsUsed),
        promotedStudentIdsForNotification
          .filter((s) => s.decision !== 'GRADUATED')
          .map((s) => s.studentId),
      );
    }

    // Dispatch non-blocking congratulations notifications
    for (const item of promotedStudentIdsForNotification) {
      try {
        void this.notifications.dispatchNotification({
          userId: item.studentId,
          schoolId,
          title:
            item.decision === 'GRADUATED'
              ? 'Congratulations, Graduate! 🎓'
              : `Promoted to ${item.toClassName}! 🎉`,
          body:
            item.decision === 'GRADUATED'
              ? `You have successfully completed ${sourceClassFull.name} and transitioned to Graduated Alumni status. All past report cards remain permanently accessible.`
              : `You have been promoted from ${sourceClassFull.name} to ${item.toClassName}${item.decision === 'ON_TRIAL' ? ' (On Trial)' : ''}. Welcome to your new class!`,
          category: 'SCHOOL',
          deepLink: '/results',
          dataJson: { decision: item.decision, toClassName: item.toClassName },
        });
      } catch {
        // Non-blocking
      }
    }

    return {
      ...txResult,
      generatedInvoicesCount,
      canUndo: true,
    };
  }

  // ============================================================================
  // 5. EXECUTE ATOMIC TOP-DOWN SCHOOL-WIDE SESSION ROLLOVER (1 CLICK!)
  // ============================================================================

  async executeSchoolWideRollover(
    schoolId: string,
    actorId: string,
    actorRole: string,
    dto: ExecuteSchoolRolloverDto,
  ) {
    if (actorRole !== 'SCHOOL_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only School Administrators can execute a school-wide rollover.');
    }

    const overview = await this.getPromotionOverview(schoolId, actorId, actorRole, {
      sessionId: dto.sessionId,
      passMarkPercent: dto.passMarkPercent,
      trialMarkPercent: dto.trialMarkPercent,
    });

    const selectedClassSet =
      Array.isArray(dto.classIds) && dto.classIds.length > 0 ? new Set(dto.classIds) : null;

    // Classes in overview are already sorted TOP-DOWN by ladderRank descending!
    const targetClasses = overview.classes.filter(
      (c) =>
        c.studentCount > 0 &&
        (!selectedClassSet || selectedClassSet.has(c.classId)) &&
        (c.isGraduatingClass || !!c.existingTargetClass || (dto.autoCreateMissingClasses !== false && !!c.suggestedNextClassName)),
    );

    if (targetClasses.length === 0) {
      throw new BadRequestException(
        'No eligible classes with active students found for school-wide rollover.',
      );
    }

    // Snapshot every class preview BEFORE touching the DB so promoted students are NEVER double-processed
    const previews = await Promise.all(
      targetClasses.map((c) =>
        this.getClassPromotionPreview(schoolId, c.classId, {
          sessionId: dto.sessionId,
          passMarkPercent: dto.passMarkPercent,
          trialMarkPercent: dto.trialMarkPercent,
        }),
      ),
    );

    const allSchoolClasses = await this.prisma.schoolClass.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        levelCode: true,
        departmentId: true,
        minAttendancePercent: true,
      },
    });
    const classLookup = new Map(allSchoolClasses.map((c) => [c.id, c]));
    const overrideMap = new Map<string, StudentPromotionDecisionDto>(
      (dto.overrides || []).map((o) => [o.studentId, o]),
    );
    const autoCreate = dto.autoCreateMissingClasses !== false;

    const destinationClassIdsUsed = new Set<string>();
    const promotedStudentNotifications: Array<{
      studentId: string;
      decision: string;
      fromClassName: string;
      toClassName: string | null;
    }> = [];

    const txResult = await this.prisma.$transaction(
      async (tx) => {
        let totalProcessed = 0;
        let promotedCount = 0;
        let repeatedCount = 0;
        let graduatedCount = 0;
        let autoCreatedClassesCount = 0;

        // Optionally create & activate the next Academic Session + First Term/Semester
        let nextSessionName =
          dto.createNextSessionName?.trim() || overview.suggestedNextSessionName;
        if (dto.createNextSessionName?.trim()) {
          const cleanSessName = dto.createNextSessionName.trim();
          const existingSess = await tx.academicSession.findFirst({
            where: { schoolId, name: { equals: cleanSessName, mode: 'insensitive' } },
          });
          if (!existingSess) {
            await tx.academicSession.updateMany({
              where: { schoolId },
              data: { isCurrent: false },
            });
            await tx.academicTerm.updateMany({
              where: { session: { schoolId } },
              data: { isCurrent: false },
            });
            await tx.academicSession.create({
              data: {
                schoolId,
                name: cleanSessName,
                isCurrent: true,
                terms: {
                  create: [
                    {
                      name: overview.school.isTertiary ? 'First Semester' : 'First Term',
                      isCurrent: true,
                      isEnabled: true,
                      isClosed: false,
                    },
                  ],
                },
              },
            });
          }
        }

        const batch = await tx.promotionBatch.create({
          data: {
            schoolId,
            fromSessionId: overview.activeSession?.id || null,
            fromSessionName: overview.activeSession?.name || 'Current Session',
            toSessionName: nextSessionName,
            scopeType: 'SCHOOL_WIDE',
            status: 'EXECUTED',
            passMarkPercent: overview.passMarkPercent,
            trialMarkPercent: overview.trialMarkPercent,
            executedById: actorId,
            canUndoUntil: dayjs().add(24, 'hour').toDate(),
            notes:
              dto.notes?.trim() ||
              `School-Wide Top-Down Rollover across ${previews.length} classes`,
          },
        });

        const entryRows: any[] = [];
        const enrollmentCreates: Array<{ classId: string; studentId: string }> = [];
        const groupedMoves = new Map<string, { studentIds: string[]; level: string }>();
        const graduatedIds: string[] = [];

        // Process TOP-DOWN in exact ladder order
        for (const preview of previews) {
          const sourceClass = classLookup.get(preview.sourceClass.id);
          if (!sourceClass) continue;

          let defaultTargetId = preview.defaultTarget.classId;
          const defaultTargetName = preview.defaultTarget.className;

          if (
            !preview.sourceClass.isGraduatingClass &&
            !defaultTargetId &&
            defaultTargetName &&
            autoCreate
          ) {
            const ensured = await this.ensureDestinationClass(
              tx,
              schoolId,
              sourceClass,
              defaultTargetName,
              preview.defaultTarget.levelCode,
            );
            defaultTargetId = ensured.id;
            classLookup.set(ensured.id, {
              id: ensured.id,
              name: ensured.name,
              levelCode: ensured.levelCode,
              departmentId: sourceClass.departmentId,
              minAttendancePercent: sourceClass.minAttendancePercent,
            });
            if (ensured.created) autoCreatedClassesCount++;
          }

          for (const student of preview.students) {
            totalProcessed++;
            const override = overrideMap.get(student.studentId);
            let decision = override?.decision || student.suggestedDecision;

            let toClassId: string | null = null;
            let toClassName: string | null = null;
            let toLevel: string | null = student.currentLevel;
            let toAcademicStatus = 'ACTIVE';

            if (decision === 'REPEATED') {
              repeatedCount++;
              toClassId = sourceClass.id;
              toClassName = sourceClass.name;
            } else if (decision === 'GRADUATED' || !defaultTargetId) {
              decision = 'GRADUATED';
              graduatedCount++;
              toClassId = null;
              toClassName = 'Graduated Alumni';
              toLevel = 'ALUMNI';
              toAcademicStatus = 'GRADUATED';
              graduatedIds.push(student.studentId);
            } else {
              promotedCount++;
              const destId =
                override?.targetClassId || student.overrideTargetClassId || defaultTargetId;
              const destInfo = classLookup.get(destId);
              toClassId = destId;
              toClassName = destInfo?.name || defaultTargetName || 'Next Class';
              toLevel = destInfo?.levelCode || toClassName;
              destinationClassIdsUsed.add(destId);

              if (!groupedMoves.has(destId)) {
                groupedMoves.set(destId, { studentIds: [], level: toLevel });
              }
              groupedMoves.get(destId)!.studentIds.push(student.studentId);
              enrollmentCreates.push({ classId: destId, studentId: student.studentId });
            }

            entryRows.push({
              batchId: batch.id,
              studentId: student.studentId,
              fromClassId: sourceClass.id,
              fromClassName: sourceClass.name,
              fromLevel: student.currentLevel,
              fromAcademicStatus: 'ACTIVE',
              toClassId,
              toClassName,
              toLevel,
              toAcademicStatus,
              decision,
              annualAverage: student.annualAverage,
              unpaidArrearsKobo: student.unpaidArrearsKobo,
            });

            if (decision !== 'REPEATED') {
              promotedStudentNotifications.push({
                studentId: student.studentId,
                decision,
                fromClassName: sourceClass.name,
                toClassName,
              });
            }
          }
        }

        // Execute batched student updates
        for (const [destClassId, group] of groupedMoves.entries()) {
          await tx.user.updateMany({
            where: { id: { in: group.studentIds } },
            data: { classId: destClassId },
          });
          await tx.studentProfile.updateMany({
            where: { userId: { in: group.studentIds } },
            data: {
              classId: destClassId,
              level: group.level,
              academicStatus: 'ACTIVE',
              graduatedAt: null,
            },
          });
        }

        if (enrollmentCreates.length > 0) {
          await tx.classEnrollment.createMany({
            data: enrollmentCreates,
            skipDuplicates: true,
          });
        }

        if (graduatedIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: graduatedIds } },
            data: { classId: null },
          });
          await tx.studentProfile.updateMany({
            where: { userId: { in: graduatedIds } },
            data: {
              classId: null,
              level: 'ALUMNI',
              academicStatus: 'GRADUATED',
              graduatedAt: new Date(),
            },
          });
        }

        if (entryRows.length > 0) {
          await tx.promotionBatchEntry.createMany({ data: entryRows });
        }

        await tx.promotionClassReview.deleteMany({
          where: {
            schoolId,
            classId: { in: previews.map((p) => p.sourceClass.id) },
          },
        });

        return tx.promotionBatch.update({
          where: { id: batch.id },
          data: {
            totalProcessed,
            promotedCount,
            repeatedCount,
            graduatedCount,
            autoCreatedClassesCount,
          },
        });
      },
      { timeout: 30000 },
    );

    let generatedInvoicesCount = 0;
    if (dto.autoIssueNewClassFees !== false && destinationClassIdsUsed.size > 0) {
      generatedInvoicesCount = await this.issueNewClassInvoicesForBatch(
        schoolId,
        txResult.id,
        Array.from(destinationClassIdsUsed),
        promotedStudentNotifications
          .filter((s) => s.decision !== 'GRADUATED')
          .map((s) => s.studentId),
      );
    }

    for (const item of promotedStudentNotifications) {
      try {
        void this.notifications.dispatchNotification({
          userId: item.studentId,
          schoolId,
          title:
            item.decision === 'GRADUATED'
              ? 'Congratulations, Graduate! 🎓'
              : `New Session: Promoted to ${item.toClassName}! 🎉`,
          body:
            item.decision === 'GRADUATED'
              ? `Congratulations on graduating from ${item.fromClassName}! Your academic transcripts remain available anytime.`
              : `Welcome to the new session! You have been promoted from ${item.fromClassName} to ${item.toClassName}.`,
          category: 'SCHOOL',
          deepLink: '/results',
          dataJson: { decision: item.decision, toClassName: item.toClassName },
        });
      } catch {
        // Non-blocking
      }
    }

    return {
      ...txResult,
      generatedInvoicesCount,
      canUndo: true,
    };
  }

  // ============================================================================
  // 6. BATCH HISTORY & 1-CLICK UNDO ROLLBACK (SAFE 24-HOUR REVERSAL)
  // ============================================================================

  async getPromotionBatches(schoolId: string) {
    const batches = await this.prisma.promotionBatch.findMany({
      where: { schoolId },
      include: {
        executedBy: { select: { id: true, fullName: true } },
        rolledBackBy: { select: { id: true, fullName: true } },
        _count: { select: { entries: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const now = new Date();
    return batches.map((b) => ({
      ...b,
      canUndo: b.status === 'EXECUTED' && !!b.canUndoUntil && b.canUndoUntil > now,
    }));
  }

  async undoPromotionBatch(
    schoolId: string,
    batchId: string,
    actorId: string,
    actorRole: string,
  ) {
    if (actorRole !== 'SCHOOL_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only School Administrators can undo a promotion batch.');
    }

    const batch = await this.prisma.promotionBatch.findFirst({
      where: { id: batchId, schoolId },
      include: { entries: true },
    });
    if (!batch) throw new NotFoundException('Promotion batch not found.');
    if (batch.status === 'ROLLED_BACK') {
      throw new BadRequestException('This promotion batch has already been rolled back.');
    }
    if (batch.canUndoUntil && new Date() > batch.canUndoUntil) {
      throw new BadRequestException(
        'The 24-hour safe undo window for this promotion batch has expired.',
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const invoicesToCleanup: string[] = [];

        // Group reverts by original classId + level + status for clean, fast restoration
        for (const entry of batch.entries) {
          await tx.user.update({
            where: { id: entry.studentId },
            data: { classId: entry.fromClassId },
          });
          await tx.studentProfile.updateMany({
            where: { userId: entry.studentId, schoolId },
            data: {
              classId: entry.fromClassId,
              level: entry.fromLevel || '100L',
              academicStatus: entry.fromAcademicStatus || 'ACTIVE',
              graduatedAt: null,
            },
          });

          if (entry.toClassId && entry.toClassId !== entry.fromClassId) {
            await tx.classEnrollment.deleteMany({
              where: { classId: entry.toClassId, studentId: entry.studentId },
            });
          }
          if (entry.fromClassId) {
            await tx.classEnrollment.upsert({
              where: {
                classId_studentId: { classId: entry.fromClassId, studentId: entry.studentId },
              },
              update: {},
              create: { classId: entry.fromClassId, studentId: entry.studentId },
            });
          }

          if (entry.createdInvoiceIds?.length) {
            invoicesToCleanup.push(...entry.createdInvoiceIds);
          }
        }

        // Safely delete ONLY untouched unpaid invoices created by this rollover (never touch paid invoices or older arrears!)
        let removedInvoicesCount = 0;
        if (invoicesToCleanup.length > 0) {
          const del = await tx.studentInvoice.deleteMany({
            where: {
              id: { in: invoicesToCleanup },
              schoolId,
              status: 'UNPAID',
              paidAmountKobo: 0,
            },
          });
          removedInvoicesCount = del.count;
        }

        const rolledBack = await tx.promotionBatch.update({
          where: { id: batch.id },
          data: {
            status: 'ROLLED_BACK',
            rolledBackById: actorId,
            rolledBackAt: new Date(),
          },
        });

        return {
          ...rolledBack,
          restoredStudentsCount: batch.entries.length,
          removedUnpaidInvoicesCount: removedInvoicesCount,
        };
      },
      { timeout: 25000 },
    );

    return result;
  }
}
