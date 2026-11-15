import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PositionRankingCalculator } from './calculators/position-ranking.calculator.js';
import { GpaCgpaCalculator } from './calculators/gpa-cgpa.calculator.js';
import {
  InstitutionStage,
  resolveCohortGroup,
} from './calculators/cohort-grouping.helper.js';
import {
  LiveRankingMover,
  LiveRankingsGateway,
} from './gateways/live-rankings.gateway.js';

export type LiveRankingScope =
  | 'CLASS'
  | 'COMBINED_CLASS'
  | 'SUBJECT'
  | 'DEPARTMENT'
  | 'FACULTY'
  | 'SCHOOL'
  | 'SCHOOL_TOP_10';

export interface LiveRankingRow {
  rank: number | null;
  ordinal: string;
  previousRank: number | null;
  rankDelta: number;
  isNew: boolean;
  studentId: string;
  fullName: string;
  matricOrAdmissionNo: string;
  avatarUrl: string | null;
  classId: string;
  className: string;
  combinedKey: string;
  combinedLabel: string;
  departmentName: string | null;
  unitName: string | null;
  averageScore: number;
  totalPoints: number;
  gpa: number;
  gpaScaleMax: number;
  totalUnits: number;
  gradedSubjectsCount: number;
  enrolledSubjectsCount: number;
  rating: number;
  letterGrade: string;
  bestSubject: { courseCode: string; name: string; score: number } | null;
  latestUpdatedAt: string | null;
  isMe: boolean;
}

interface SnapshotState {
  previous: Map<string, number>;
  latest: Map<string, number>;
}

@Injectable()
export class LiveRankingsService {
  /**
   * Tracks previous vs latest ranks per (schoolId::termId::scopeKey) so live score
   * saves immediately surface SofaScore-style rank movements (▲ +2, ▼ -1, NEW).
   */
  private readonly rankSnapshots = new Map<string, SnapshotState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveRankingsGateway,
    private readonly rankingCalculator: PositionRankingCalculator,
    private readonly gpaCalculator: GpaCgpaCalculator,
  ) {}

  private isTertiaryInstitution(institutionType?: string | null): boolean {
    return (
      institutionType === 'UNIVERSITY' ||
      institutionType === 'POLYTECHNIC' ||
      institutionType === 'COLLEGE_OF_EDUCATION' ||
      institutionType === 'TECHNICAL'
    );
  }

  private getSnapshotKey(schoolId: string, termId: string, scopeKey: string) {
    return `${schoolId}::${termId}::${scopeKey}`;
  }

  private buildRankMap(rows: Array<{ studentId: string; rank: number | null }>) {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.rank !== null) map.set(r.studentId, r.rank);
    }
    return map;
  }

  /**
   * Capture current rankings as the baseline BEFORE applying a score update,
   * then commit the updated rankings after the write so deltas reflect the latest save.
   */
  async captureBaselineSnapshot(schoolId: string, termId: string) {
    try {
      const dataset = await this.computeSchoolDataset(schoolId, termId);
      const schoolKey = this.getSnapshotKey(schoolId, termId, 'SCHOOL');
      if (!this.rankSnapshots.has(schoolKey)) {
        const ranked = this.rankRows(dataset.allStudentRows, dataset.isTertiary);
        const map = this.buildRankMap(ranked);
        this.rankSnapshots.set(schoolKey, {
          previous: new Map(map),
          latest: new Map(map),
        });
      }

      // Also capture per-class and per-combined baselines if unseen
      for (const cls of dataset.classesMeta) {
        const clsKey = this.getSnapshotKey(schoolId, termId, `CLASS:${cls.id}`);
        if (!this.rankSnapshots.has(clsKey)) {
          const subset = dataset.allStudentRows.filter((r) => r.classId === cls.id);
          const map = this.buildRankMap(this.rankRows(subset, dataset.isTertiary));
          this.rankSnapshots.set(clsKey, {
            previous: new Map(map),
            latest: new Map(map),
          });
        }
      }

      for (const comb of dataset.combinedCohorts) {
        const cKey = this.getSnapshotKey(
          schoolId,
          termId,
          `COMBINED:${comb.key}`,
        );
        if (!this.rankSnapshots.has(cKey)) {
          const idSet = new Set(comb.classIds);
          const subset = dataset.allStudentRows.filter((r) => idSet.has(r.classId));
          const map = this.buildRankMap(this.rankRows(subset, dataset.isTertiary));
          this.rankSnapshots.set(cKey, {
            previous: new Map(map),
            latest: new Map(map),
          });
        }
      }
    } catch {
      // Non-critical telemetry snapshot
    }
  }

  async broadcastScoreMutation(params: {
    schoolId: string;
    termId: string;
    eventType: 'GRADES_SAVED' | 'CBT_IMPORTED' | 'RESULTS_PUBLISHED' | 'CONFIG_UPDATED';
    subjectId?: string;
    subjectName?: string;
    classId?: string;
    className?: string;
    updatedCount?: number;
  }) {
    try {
      const dataset = await this.computeSchoolDataset(params.schoolId, params.termId);

      // Rotate snapshots for SCHOOL, touched CLASS, and touched COMBINED cohort
      const rotate = (scopeKey: string, rows: LiveRankingRow[]) => {
        const ranked = this.rankRows(rows, dataset.isTertiary);
        const newMap = this.buildRankMap(ranked);
        const snapKey = this.getSnapshotKey(params.schoolId, params.termId, scopeKey);
        const existing = this.rankSnapshots.get(snapKey);
        this.rankSnapshots.set(snapKey, {
          previous: existing ? new Map(existing.latest) : new Map(),
          latest: newMap,
        });
        return { ranked, prevMap: existing?.latest ?? new Map<string, number>() };
      };

      const schoolResult = rotate('SCHOOL', dataset.allStudentRows);
      let combinedKey: string | undefined;
      let combinedLabel: string | undefined;
      let moversSource = schoolResult;

      if (params.classId) {
        const clsMeta = dataset.classesMeta.find((c) => c.id === params.classId);
        if (clsMeta) {
          combinedKey = clsMeta.cohort.combinedKey;
          combinedLabel = clsMeta.cohort.combinedLabel;
          const classResult = rotate(
            `CLASS:${params.classId}`,
            dataset.allStudentRows.filter((r) => r.classId === params.classId),
          );
          const idSet = new Set(
            dataset.classesMeta
              .filter((c) => c.cohort.combinedKey === clsMeta.cohort.combinedKey)
              .map((c) => c.id),
          );
          rotate(
            `COMBINED:${clsMeta.cohort.combinedKey}`,
            dataset.allStudentRows.filter((r) => idSet.has(r.classId)),
          );
          moversSource = classResult;
        }
      }

      const movers: LiveRankingMover[] = moversSource.ranked
        .filter((r) => r.rank !== null)
        .map((r) => {
          const prev = moversSource.prevMap.get(r.studentId) ?? null;
          const delta = prev !== null && r.rank !== null ? prev - r.rank : 0;
          return {
            studentId: r.studentId,
            fullName: r.fullName,
            className: r.className,
            newRank: r.rank!,
            previousRank: prev,
            rankDelta: delta,
            averageScore: r.averageScore,
            gpa: r.gpa,
          };
        })
        .sort(
          (a, b) =>
            Math.abs(b.rankDelta) - Math.abs(a.rankDelta) ||
            a.newRank - b.newRank,
        )
        .slice(0, 5);

      const summaryText =
        params.eventType === 'RESULTS_PUBLISHED'
          ? `${params.className || 'Class'} official results published`
          : params.subjectName
          ? `${params.className ? `${params.className} • ` : ''}${params.subjectName} scores updated (${params.updatedCount ?? movers.length} entries)`
          : `${params.className || 'School'} grading standings updated`;

      this.gateway.emitLiveUpdate({
        schoolId: params.schoolId,
        termId: params.termId,
        termName: dataset.term.name,
        sessionName: dataset.term.sessionName,
        eventType: params.eventType,
        subjectId: params.subjectId,
        subjectName: params.subjectName,
        classId: params.classId,
        className: params.className,
        combinedKey,
        combinedLabel,
        updatedCount: params.updatedCount,
        summaryText,
        movers,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Never block grade mutations if websocket broadcast encounters transient issues
    }
  }

  /**
   * Role-scoped Live SofaScore-style Standings endpoint for School Admins, Teachers/Lecturers, and Students.
   */
  async getLiveRankings(
    userId: string,
    schoolId: string,
    query: {
      scope?: LiveRankingScope;
      termId?: string;
      sessionId?: string;
      classId?: string;
      combinedKey?: string;
      subjectId?: string;
      departmentId?: string;
      unitId?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        studentProfile: {
          select: { classId: true, departmentId: true, matricOrAdmissionNo: true },
        },
        teacherProfile: {
          include: {
            assignedClasses: { select: { id: true } },
            assignedSubjects: { select: { id: true, classId: true } },
          },
        },
        memberships: {
          where: { schoolId },
          select: { role: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found.');
    const effectiveRole =
      user.memberships?.[0]?.role || user.role;

    if (
      effectiveRole !== 'SUPER_ADMIN' &&
      user.schoolId !== schoolId &&
      user.memberships.length === 0
    ) {
      throw new ForbiddenException('You do not belong to this institution.');
    }

    // Resolve term & sessions
    const sessions = await this.prisma.academicSession.findMany({
      where: { schoolId },
      include: { terms: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    const allTerms = sessions.flatMap((s) =>
      s.terms.map((t) => ({
        id: t.id,
        name: t.name,
        isCurrent: t.isCurrent,
        sessionId: s.id,
        sessionName: s.name,
      })),
    );

    const resolvedTerm =
      (query.termId && allTerms.find((t) => t.id === query.termId)) ||
      (query.sessionId &&
        allTerms.find((t) => t.sessionId === query.sessionId && t.isCurrent)) ||
      (query.sessionId && allTerms.find((t) => t.sessionId === query.sessionId)) ||
      allTerms.find((t) => t.isCurrent) ||
      allTerms[0];

    if (!resolvedTerm) {
      throw new NotFoundException('No academic term found for this institution.');
    }

    const dataset = await this.computeSchoolDataset(schoolId, resolvedTerm.id);

    // Ensure a baseline snapshot exists so subsequent saves show rank deltas
    await this.captureBaselineSnapshot(schoolId, resolvedTerm.id);

    // Determine role context & enforce student / teacher boundaries
    let activeScope: LiveRankingScope = query.scope || (
      effectiveRole === 'STUDENT' ? 'CLASS' : 'SCHOOL'
    );

    let studentContext: {
      myClassId: string | null;
      myClassName: string | null;
      myCombinedKey: string | null;
      myCombinedLabel: string | null;
      myDeptCombinedKey: string | null;
      myDeptCombinedLabel: string | null;
    } | null = null;

    // Student class resolution
    const myStudentRow =
      effectiveRole === 'STUDENT'
        ? dataset.allStudentRows.find((r) => r.studentId === userId) || null
        : null;
    const studentClassId =
      user.studentProfile?.classId || user.classId || myStudentRow?.classId || null;
    const studentClassMeta = studentClassId
      ? dataset.classesMeta.find((c) => c.id === studentClassId) || null
      : null;

    if (effectiveRole === 'STUDENT') {
      studentContext = {
        myClassId: studentClassMeta?.id ?? null,
        myClassName: studentClassMeta?.name ?? null,
        myCombinedKey: studentClassMeta?.cohort.combinedKey ?? null,
        myCombinedLabel: studentClassMeta?.cohort.combinedLabel ?? null,
        myDeptCombinedKey: studentClassMeta?.cohort.deptCombinedKey ?? null,
        myDeptCombinedLabel: studentClassMeta?.cohort.deptCombinedLabel ?? null,
      };

      if (activeScope === 'SCHOOL') {
        activeScope = 'SCHOOL_TOP_10';
      }
      if (
        activeScope !== 'CLASS' &&
        activeScope !== 'COMBINED_CLASS' &&
        activeScope !== 'SCHOOL_TOP_10'
      ) {
        throw new ForbiddenException(
          'Students can view live rankings for their own class, combined level, or Overall School Top 10.',
        );
      }
      if (activeScope === 'CLASS') {
        if (!studentClassId) {
          throw new BadRequestException('You are not assigned to a class cohort yet.');
        }
        if (query.classId && query.classId !== studentClassId) {
          throw new ForbiddenException(
            'Students can only view live rankings for their own enrolled class.',
          );
        }
      }
      if (activeScope === 'COMBINED_CLASS') {
        const targetCombKey =
          query.combinedKey ||
          studentClassMeta?.cohort.combinedKey ||
          studentClassMeta?.cohort.deptCombinedKey;
        const allowedKeys = new Set(
          [
            studentClassMeta?.cohort.combinedKey,
            studentClassMeta?.cohort.deptCombinedKey,
          ].filter(Boolean) as string[],
        );
        if (!targetCombKey || !allowedKeys.has(targetCombKey)) {
          throw new ForbiddenException(
            'Students can only view combined class/level rankings for their own cohort.',
          );
        }
      }
    }

    // Teacher assigned classes & subjects
    const teacherAssignedClassIds = new Set<string>();
    const teacherAssignedSubjectIds = new Set<string>();
    if (effectiveRole === 'TEACHER') {
      user.teacherProfile?.assignedClasses.forEach((c) =>
        teacherAssignedClassIds.add(c.id),
      );
      user.teacherProfile?.assignedSubjects.forEach((s) => {
        teacherAssignedSubjectIds.add(s.id);
        if (s.classId) teacherAssignedClassIds.add(s.classId);
      });
      if (user.teacherProfile?.handlesAllSubjects) {
        dataset.subjectsMeta.forEach((subj) => {
          if (teacherAssignedClassIds.has(subj.classId)) {
            teacherAssignedSubjectIds.add(subj.id);
          }
        });
      }
      const legacyClasses = await this.prisma.schoolClass.findMany({
        where: { schoolId, formTeacherId: userId },
        select: { id: true },
      });
      legacyClasses.forEach((c) => teacherAssignedClassIds.add(c.id));
      const legacySubjects = await this.prisma.schoolSubject.findMany({
        where: { schoolId, teacherId: userId },
        select: { id: true, classId: true },
      });
      legacySubjects.forEach((s) => {
        teacherAssignedSubjectIds.add(s.id);
        if (s.classId) teacherAssignedClassIds.add(s.classId);
      });
    }

    // Filter dataset rows & compute scope standings
    let targetRows: LiveRankingRow[] = [];
    let scopeTitle = `${dataset.school.name} Live Standings`;
    let scopeSubtitle = dataset.isTertiary
      ? 'Credit-weighted live GPA table'
      : 'Live terminal average standings';
    let snapshotScopeKey = 'SCHOOL';

    if (activeScope === 'CLASS') {
      const targetClassId =
        effectiveRole === 'STUDENT'
          ? studentClassId!
          : query.classId ||
            (effectiveRole === 'TEACHER'
              ? Array.from(teacherAssignedClassIds)[0]
              : dataset.classesMeta[0]?.id);
      const clsMeta = dataset.classesMeta.find((c) => c.id === targetClassId);
      if (!clsMeta) {
        throw new NotFoundException('Target class or cohort not found.');
      }
      targetRows = dataset.allStudentRows.filter((r) => r.classId === clsMeta.id);
      scopeTitle = `${clsMeta.name} Live Table`;
      scopeSubtitle = `${clsMeta.departmentName ? `${clsMeta.departmentName} • ` : ''}${targetRows.length} enrolled student(s)`;
      snapshotScopeKey = `CLASS:${clsMeta.id}`;
    } else if (activeScope === 'COMBINED_CLASS') {
      const defaultKey =
        studentClassMeta?.cohort.combinedKey ||
        dataset.combinedCohorts.find((c) => c.isCombined)?.key ||
        dataset.combinedCohorts[0]?.key;
      const targetKey = query.combinedKey || defaultKey;
      const comb = dataset.combinedCohorts.find((c) => c.key === targetKey);
      if (!comb) {
        throw new NotFoundException('Combined class / level group not found.');
      }
      const idSet = new Set(comb.classIds);
      targetRows = dataset.allStudentRows.filter((r) => idSet.has(r.classId));
      scopeTitle = `${comb.label} (${comb.isCombined ? 'Combined Arms' : 'Full Level'})`;
      scopeSubtitle = `Merged: ${comb.armNames.join(', ')} • ${targetRows.length} student(s)`;
      snapshotScopeKey = `COMBINED:${comb.key}`;
    } else if (activeScope === 'SUBJECT') {
      const targetSubjectId =
        query.subjectId ||
        (effectiveRole === 'TEACHER'
          ? Array.from(teacherAssignedSubjectIds)[0]
          : dataset.subjectsMeta[0]?.id);
      const subj = dataset.subjectsMeta.find((s) => s.id === targetSubjectId);
      if (!subj) {
        throw new NotFoundException('Course / subject not found.');
      }
      targetRows = this.buildSubjectRows(dataset, subj.id);
      scopeTitle = `${subj.name} (${subj.courseCode})`;
      scopeSubtitle = `${subj.className} • Live subject score standings`;
      snapshotScopeKey = `SUBJECT:${subj.id}`;
    } else if (activeScope === 'DEPARTMENT') {
      const targetDeptId = query.departmentId || dataset.departmentsMeta[0]?.id;
      const dept = dataset.departmentsMeta.find((d) => d.id === targetDeptId);
      if (!dept) throw new NotFoundException('Department not found.');
      targetRows = dataset.allStudentRows.filter(
        (r) =>
          dataset.classesMeta.find((c) => c.id === r.classId)?.departmentId ===
          dept.id,
      );
      scopeTitle = `${dept.name} Standings`;
      scopeSubtitle = `All levels in ${dept.code} • ${targetRows.length} student(s)`;
      snapshotScopeKey = `DEPT:${dept.id}`;
    } else if (activeScope === 'FACULTY') {
      const targetUnitId = query.unitId || dataset.unitsMeta[0]?.id;
      const unit = dataset.unitsMeta.find((u) => u.id === targetUnitId);
      if (!unit) throw new NotFoundException('Faculty / Section not found.');
      targetRows = dataset.allStudentRows.filter(
        (r) =>
          dataset.classesMeta.find((c) => c.id === r.classId)?.unitId === unit.id,
      );
      scopeTitle = `${unit.name} Standings`;
      scopeSubtitle = `${targetRows.length} enrolled student(s)`;
      snapshotScopeKey = `UNIT:${unit.id}`;
    } else {
      targetRows = [...dataset.allStudentRows];
      scopeTitle =
        activeScope === 'SCHOOL_TOP_10'
          ? 'Overall School Top 10'
          : `${dataset.school.name} • Overall Leaderboard`;
      scopeSubtitle =
        activeScope === 'SCHOOL_TOP_10'
          ? `Top 10 performers across all classes & levels`
          : `All ${targetRows.length} enrolled students ranked live`;
      snapshotScopeKey = 'SCHOOL';
    }

    const snap = this.rankSnapshots.get(
      this.getSnapshotKey(schoolId, resolvedTerm.id, snapshotScopeKey),
    );
    const prevMap = snap?.previous ?? new Map<string, number>();

    const rankedAll = this.rankRows(
      targetRows,
      activeScope === 'SUBJECT' ? false : dataset.isTertiary,
      prevMap,
      userId,
    );

    const myStanding = rankedAll.find((r) => r.studentId === userId) || null;
    const isRestrictedTopTen =
      effectiveRole === 'STUDENT' && activeScope === 'SCHOOL_TOP_10';

    const visibleStandings = isRestrictedTopTen
      ? rankedAll.filter((r) => r.rank !== null).slice(0, 10)
      : activeScope === 'SCHOOL_TOP_10'
      ? rankedAll.filter((r) => r.rank !== null).slice(0, 10)
      : rankedAll;

    const rankedOnly = rankedAll.filter((r) => r.rank !== null);
    const passedCount = rankedOnly.filter((r) => r.averageScore >= 40).length;
    const scopeAverageScore =
      rankedOnly.length > 0
        ? Math.round(
            (rankedOnly.reduce((sum, r) => sum + r.averageScore, 0) /
              rankedOnly.length) *
              100,
          ) / 100
        : 0;

    // Shape available scope selectors according to user's role
    const availableClasses =
      effectiveRole === 'STUDENT'
        ? dataset.classesMeta
            .filter((c) => c.id === studentClassId)
            .map((c) => ({
              id: c.id,
              name: c.name,
              levelCode: c.levelCode,
              departmentName: c.departmentName,
              combinedKey: c.cohort.combinedKey,
            }))
        : effectiveRole === 'TEACHER'
        ? dataset.classesMeta
            .filter(
              (c) =>
                teacherAssignedClassIds.size === 0 ||
                teacherAssignedClassIds.has(c.id),
            )
            .map((c) => ({
              id: c.id,
              name: c.name,
              levelCode: c.levelCode,
              departmentName: c.departmentName,
              combinedKey: c.cohort.combinedKey,
            }))
        : dataset.classesMeta.map((c) => ({
            id: c.id,
            name: c.name,
            levelCode: c.levelCode,
            departmentName: c.departmentName,
            combinedKey: c.cohort.combinedKey,
          }));

    const availableCombined =
      effectiveRole === 'STUDENT'
        ? dataset.combinedCohorts.filter(
            (comb) =>
              comb.key === studentClassMeta?.cohort.combinedKey ||
              comb.key === studentClassMeta?.cohort.deptCombinedKey,
          )
        : effectiveRole === 'TEACHER'
        ? dataset.combinedCohorts.filter(
            (comb) =>
              teacherAssignedClassIds.size === 0 ||
              comb.classIds.some((id) => teacherAssignedClassIds.has(id)),
          )
        : dataset.combinedCohorts;

    const availableSubjects =
      effectiveRole === 'STUDENT'
        ? []
        : effectiveRole === 'TEACHER'
        ? dataset.subjectsMeta.filter(
            (s) =>
              teacherAssignedSubjectIds.size === 0 ||
              teacherAssignedSubjectIds.has(s.id),
          )
        : dataset.subjectsMeta;

    return {
      school: {
        id: dataset.school.id,
        name: dataset.school.name,
        institutionType: dataset.school.institutionType,
        isTertiary: dataset.isTertiary,
        gpaScaleMax: dataset.gpaScaleMax,
        logoUrl: dataset.school.logoUrl,
        primaryColor: dataset.school.primaryColor,
      },
      term: {
        id: resolvedTerm.id,
        name: resolvedTerm.name,
        sessionName: resolvedTerm.sessionName,
      },
      terms: allTerms,
      role: effectiveRole,
      activeScope,
      scopeTitle,
      scopeSubtitle,
      studentContext,
      myStanding,
      availableScopes: {
        classes: availableClasses,
        combinedClasses: availableCombined,
        subjects: availableSubjects,
        departments: effectiveRole === 'STUDENT' ? [] : dataset.departmentsMeta,
        faculties: effectiveRole === 'STUDENT' ? [] : dataset.unitsMeta,
      },
      summary: {
        totalParticipants: rankedAll.length,
        gradedParticipants: rankedOnly.length,
        topAverageScore: rankedOnly[0]?.averageScore ?? 0,
        topGpa: rankedOnly[0]?.gpa ?? 0,
        scopeAverageScore,
        passRate:
          rankedOnly.length > 0
            ? Math.round((passedCount / rankedOnly.length) * 100)
            : 0,
        isRestrictedTopTen,
      },
      podium: rankedOnly.slice(0, 3),
      standings: visibleStandings,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private async computeSchoolDataset(schoolId: string, termId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        institutionType: true,
        logoUrl: true,
        primaryColor: true,
      },
    });
    if (!school) throw new NotFoundException('Institution not found.');

    const term = await this.prisma.academicTerm.findUnique({
      where: { id: termId },
      include: { session: { select: { name: true } } },
    });
    if (!term) throw new NotFoundException('Academic term not found.');

    const isTertiary = this.isTertiaryInstitution(school.institutionType);

    const [
      schoolConfig,
      units,
      departments,
      classes,
      subjects,
      studentUsers,
      grades,
    ] = await Promise.all([
      this.prisma.assessmentConfig.findFirst({
        where: { schoolId, subjectId: null },
      }),
      this.prisma.academicUnit.findMany({
        where: { schoolId },
        select: { id: true, name: true, code: true, unitType: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { schoolId },
        include: { unit: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        include: {
          department: {
            include: { unit: { select: { id: true, name: true } } },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolSubject.findMany({
        where: { schoolId },
        include: { schoolClass: { select: { name: true } } },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.user.findMany({
        where: {
          role: 'STUDENT',
          OR: [
            { schoolId },
            { studentProfile: { schoolId } },
            { memberships: { some: { schoolId, role: 'STUDENT' } } },
          ],
        },
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          classId: true,
          studentProfile: {
            select: {
              classId: true,
              departmentId: true,
              matricOrAdmissionNo: true,
            },
          },
          classEnrollments: {
            select: { classId: true },
            take: 1,
          },
        },
      }),
      this.prisma.studentSubjectGrade.findMany({
        where: { schoolId, termId },
        include: {
          subject: {
            select: { id: true, name: true, courseCode: true, creditUnits: true },
          },
        },
      }),
    ]);

    const gpaScaleMax = Number(schoolConfig?.gpaScaleMax) || 5.0;

    // Subject count per class
    const subjectCountByClass = new Map<string, number>();
    for (const s of subjects) {
      subjectCountByClass.set(
        s.classId,
        (subjectCountByClass.get(s.classId) || 0) + 1,
      );
    }

    const classesMeta = classes.map((cls) => ({
      id: cls.id,
      name: cls.name,
      levelCode: cls.levelCode,
      departmentId: cls.departmentId,
      departmentName: cls.department?.name ?? null,
      unitId: cls.department?.unit?.id ?? null,
      unitName: cls.department?.unit?.name ?? null,
      cohort: resolveCohortGroup(
        {
          name: cls.name,
          levelCode: cls.levelCode,
          departmentId: cls.departmentId,
          departmentName: cls.department?.name ?? null,
        },
        school.institutionType,
      ),
    }));
    const classMetaById = new Map(classesMeta.map((c) => [c.id, c]));

    // Group grades by studentId
    const gradesByStudent = new Map<string, typeof grades>();
    for (const g of grades) {
      const list = gradesByStudent.get(g.studentId) || [];
      list.push(g);
      gradesByStudent.set(g.studentId, list);
    }

    // Build unified student rows (including enrolled students awaiting scores)
    const allStudentRows: LiveRankingRow[] = [];
    const seenStudentIds = new Set<string>();

    for (const stu of studentUsers) {
      seenStudentIds.add(stu.id);
      const stuGrades = gradesByStudent.get(stu.id) || [];
      const resolvedClassId =
        stu.studentProfile?.classId ||
        stu.classEnrollments?.[0]?.classId ||
        stu.classId ||
        stuGrades[0]?.classId ||
        '';
      const clsMeta = classMetaById.get(resolvedClassId);
      const enrolledSubjectsCount =
        subjectCountByClass.get(resolvedClassId) || stuGrades.length;

      allStudentRows.push(
        this.aggregateStudentRow({
          studentId: stu.id,
          fullName: stu.fullName || 'Student',
          avatarUrl: stu.avatarUrl,
          matricOrAdmissionNo: stu.studentProfile?.matricOrAdmissionNo || '—',
          clsMeta,
          stuGrades,
          enrolledSubjectsCount,
          isTertiary,
          gpaScaleMax,
          institutionType: school.institutionType,
        }),
      );
    }

    // Build Combined Cohort Options (both Campus-Level and Tertiary Dept-Level when applicable)
    const combinedMap = new Map<
      string,
      {
        key: string;
        label: string;
        stage: InstitutionStage;
        armNames: string[];
        classIds: string[];
        totalStudents: number;
      }
    >();

    const studentCountByClass = new Map<string, number>();
    for (const r of allStudentRows) {
      if (r.classId) {
        studentCountByClass.set(
          r.classId,
          (studentCountByClass.get(r.classId) || 0) + 1,
        );
      }
    }

    for (const cls of classesMeta) {
      const count = studentCountByClass.get(cls.id) || 0;
      const existing = combinedMap.get(cls.cohort.combinedKey);
      if (!existing) {
        combinedMap.set(cls.cohort.combinedKey, {
          key: cls.cohort.combinedKey,
          label: cls.cohort.combinedLabel,
          stage: cls.cohort.stage,
          armNames: [cls.name],
          classIds: [cls.id],
          totalStudents: count,
        });
      } else {
        existing.armNames.push(cls.name);
        existing.classIds.push(cls.id);
        existing.totalStudents += count;
      }

      if (cls.cohort.deptCombinedKey && cls.cohort.deptCombinedLabel) {
        const deptEx = combinedMap.get(cls.cohort.deptCombinedKey);
        if (!deptEx) {
          combinedMap.set(cls.cohort.deptCombinedKey, {
            key: cls.cohort.deptCombinedKey,
            label: cls.cohort.deptCombinedLabel,
            stage: cls.cohort.stage,
            armNames: [cls.name],
            classIds: [cls.id],
            totalStudents: count,
          });
        } else {
          deptEx.armNames.push(cls.name);
          deptEx.classIds.push(cls.id);
          deptEx.totalStudents += count;
        }
      }
    }

    const combinedCohorts = Array.from(combinedMap.values())
      .map((c) => ({
        ...c,
        isCombined: c.classIds.length > 1,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      school,
      term: {
        id: term.id,
        name: term.name,
        sessionName: term.session.name,
      },
      isTertiary,
      gpaScaleMax,
      unitsMeta: units,
      departmentsMeta: departments.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        unitName: d.unit?.name ?? null,
      })),
      classesMeta,
      subjectsMeta: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        courseCode: s.courseCode,
        creditUnits: s.creditUnits,
        classId: s.classId,
        className: s.schoolClass.name,
      })),
      combinedCohorts,
      grades,
      studentUsers,
      allStudentRows,
    };
  }

  private aggregateStudentRow(params: {
    studentId: string;
    fullName: string;
    avatarUrl: string | null;
    matricOrAdmissionNo: string;
    clsMeta?: {
      id: string;
      name: string;
      departmentName: string | null;
      unitName: string | null;
      cohort: { combinedKey: string; combinedLabel: string };
    };
    stuGrades: Array<{
      totalScore: number;
      gradePoint: number;
      letterGrade: string;
      updatedAt: Date;
      subject: { id: string; name: string; courseCode: string; creditUnits: number | null };
    }>;
    enrolledSubjectsCount: number;
    isTertiary: boolean;
    gpaScaleMax: number;
    institutionType?: string | null;
  }): LiveRankingRow {
    const gradedSubjectsCount = params.stuGrades.length;
    let totalPoints = 0;
    let weightedQuality = 0;
    let totalUnits = 0;
    let latestTs = 0;
    let bestSubject: { courseCode: string; name: string; score: number } | null =
      null;

    for (const g of params.stuGrades) {
      const score = Number(g.totalScore) || 0;
      const gp = Number(g.gradePoint) || 0;
      const units = Math.max(1, Number(g.subject?.creditUnits) || 1);
      totalPoints += score;
      weightedQuality += gp * units;
      totalUnits += units;

      const ts = new Date(g.updatedAt).getTime();
      if (ts > latestTs) latestTs = ts;

      if (!bestSubject || score > bestSubject.score) {
        bestSubject = {
          courseCode: g.subject?.courseCode || 'SUBJ',
          name: g.subject?.name || 'Subject',
          score: Math.round(score * 100) / 100,
        };
      }
    }

    const averageScore =
      gradedSubjectsCount > 0
        ? Math.round((totalPoints / gradedSubjectsCount) * 100) / 100
        : 0;
    const gpa =
      totalUnits > 0
        ? Math.round((weightedQuality / totalUnits) * 100) / 100
        : 0;

    // SofaScore 1.0 - 10.0 Rating derived dynamically
    const rating =
      gradedSubjectsCount === 0
        ? 0
        : params.isTertiary
        ? Math.min(
            10,
            Math.max(
              1,
              Math.round(((gpa / Math.max(1, params.gpaScaleMax)) * 10) * 10) /
                10,
            ),
          )
        : Math.min(
            10,
            Math.max(1, Math.round((averageScore / 10) * 10) / 10),
          );

    const band =
      gradedSubjectsCount > 0
        ? this.gpaCalculator.resolveGradeBand(
            averageScore,
            undefined,
            params.gpaScaleMax,
            params.institutionType,
          )
        : null;

    return {
      rank: null,
      ordinal: '—',
      previousRank: null,
      rankDelta: 0,
      isNew: false,
      studentId: params.studentId,
      fullName: params.fullName,
      matricOrAdmissionNo: params.matricOrAdmissionNo,
      avatarUrl: params.avatarUrl,
      classId: params.clsMeta?.id ?? '',
      className: params.clsMeta?.name ?? 'Unassigned',
      combinedKey: params.clsMeta?.cohort.combinedKey ?? 'GENERAL',
      combinedLabel: params.clsMeta?.cohort.combinedLabel ?? 'General',
      departmentName: params.clsMeta?.departmentName ?? null,
      unitName: params.clsMeta?.unitName ?? null,
      averageScore,
      totalPoints: Math.round(totalPoints * 100) / 100,
      gpa,
      gpaScaleMax: params.gpaScaleMax,
      totalUnits,
      gradedSubjectsCount,
      enrolledSubjectsCount: params.enrolledSubjectsCount,
      rating,
      letterGrade: band?.grade ?? '—',
      bestSubject,
      latestUpdatedAt: latestTs > 0 ? new Date(latestTs).toISOString() : null,
      isMe: false,
    };
  }

  private buildSubjectRows(
    dataset: Awaited<ReturnType<LiveRankingsService['computeSchoolDataset']>>,
    subjectId: string,
  ): LiveRankingRow[] {
    const subj = dataset.subjectsMeta.find((s) => s.id === subjectId);
    if (!subj) return [];

    const subjectGrades = dataset.grades.filter((g) => g.subjectId === subjectId);
    const gradeByStudent = new Map(subjectGrades.map((g) => [g.studentId, g]));

    const enrolledInClass = dataset.allStudentRows.filter(
      (r) => r.classId === subj.classId || gradeByStudent.has(r.studentId),
    );

    return enrolledInClass.map((baseRow) => {
      const g = gradeByStudent.get(baseRow.studentId);
      if (!g) {
        return {
          ...baseRow,
          averageScore: 0,
          totalPoints: 0,
          gpa: 0,
          gradedSubjectsCount: 0,
          enrolledSubjectsCount: 1,
          rating: 0,
          letterGrade: '—',
          bestSubject: null,
          latestUpdatedAt: null,
        };
      }
      const score = Math.round((Number(g.totalScore) || 0) * 100) / 100;
      const gp = Math.round((Number(g.gradePoint) || 0) * 100) / 100;
      const rating = Math.min(
        10,
        Math.max(1, Math.round((score / 10) * 10) / 10),
      );
      return {
        ...baseRow,
        averageScore: score,
        totalPoints: score,
        gpa: gp,
        totalUnits: subj.creditUnits ?? 0,
        gradedSubjectsCount: 1,
        enrolledSubjectsCount: 1,
        rating,
        letterGrade: g.letterGrade || 'F',
        bestSubject: {
          courseCode: subj.courseCode,
          name: subj.name,
          score,
        },
        latestUpdatedAt: new Date(g.updatedAt).toISOString(),
      };
    });
  }

  private rankRows(
    rows: LiveRankingRow[],
    useGpaPrimary: boolean,
    prevMap?: Map<string, number>,
    currentUserId?: string,
  ): LiveRankingRow[] {
    const graded = rows.filter((r) => r.gradedSubjectsCount > 0);
    const pending = rows
      .filter((r) => r.gradedSubjectsCount === 0)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const sortedGraded = [...graded].sort((a, b) => {
      if (useGpaPrimary && Math.abs(b.gpa - a.gpa) > 0.001) {
        return b.gpa - a.gpa;
      }
      if (Math.abs(b.averageScore - a.averageScore) > 0.001) {
        return b.averageScore - a.averageScore;
      }
      if (Math.abs(b.totalPoints - a.totalPoints) > 0.001) {
        return b.totalPoints - a.totalPoints;
      }
      return b.gradedSubjectsCount - a.gradedSubjectsCount;
    });

    let currentRank = 0;
    let prevPrimaryVal: number | null = null;

    const rankedGraded: LiveRankingRow[] = sortedGraded.map((row, idx) => {
      const primaryVal = useGpaPrimary ? row.gpa : row.averageScore;
      const isTied =
        prevPrimaryVal !== null && Math.abs(primaryVal - prevPrimaryVal) <= 0.001;
      if (!isTied) {
        currentRank = idx + 1;
      }
      prevPrimaryVal = primaryVal;

      const prevRank = prevMap?.get(row.studentId) ?? null;
      const hasPrev = Boolean(prevMap && prevMap.size > 0);
      const isNew = hasPrev && prevRank === null;
      const rankDelta = prevRank !== null ? prevRank - currentRank : 0;

      return {
        ...row,
        rank: currentRank,
        ordinal: this.rankingCalculator.formatOrdinal(currentRank),
        previousRank: prevRank,
        rankDelta,
        isNew,
        isMe: Boolean(currentUserId && row.studentId === currentUserId),
      };
    });

    const rankedPending: LiveRankingRow[] = pending.map((row) => ({
      ...row,
      rank: null,
      ordinal: '—',
      previousRank: null,
      rankDelta: 0,
      isNew: false,
      isMe: Boolean(currentUserId && row.studentId === currentUserId),
    }));

    return [...rankedGraded, ...rankedPending];
  }
}
