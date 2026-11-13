import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AssessmentComponentConfig,
  CaCalculationMode,
  PositionRankingCalculator,
} from './calculators/position-ranking.calculator.js';
import {
  GpaCgpaCalculator,
  GradeScaleBand,
} from './calculators/gpa-cgpa.calculator.js';
import { ReportCardRemarksAiService } from '../ai/services/report-card-remarks-ai.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface SaveGradeEntryInput {
  studentId: string;
  scores: Record<string, number | null>;
  teacherComment?: string;
}

export interface UpsertConfigInput {
  caMode?: CaCalculationMode;
  caWeightTotal?: number;
  examWeightTotal?: number;
  components?: AssessmentComponentConfig[];
  gradeScale?: GradeScaleBand[];
  gpaScaleMax?: number;
  applyToSchool?: boolean;
  overrideSubjects?: boolean;
  resetToSchoolDefault?: boolean;
}

@Injectable()
export class AssessmentsGradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rankingCalculator: PositionRankingCalculator,
    private readonly gpaCalculator: GpaCgpaCalculator,
    private readonly remarksAi: ReportCardRemarksAiService,
    private readonly notifications: NotificationsService,
  ) {}

  private isTertiaryInstitution(institutionType?: string | null): boolean {
    return (
      institutionType === 'UNIVERSITY' ||
      institutionType === 'POLYTECHNIC' ||
      institutionType === 'COLLEGE_OF_EDUCATION' ||
      institutionType === 'TECHNICAL'
    );
  }

  /**
   * Ensure at least one AcademicSession & AcademicTerm exists for a school
   * so Gradebook & Broadsheet work out-of-the-box for any tenant.
   */
  async ensureDefaultTerms(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, institutionType: true },
    });
    if (!school) {
      throw new NotFoundException('Institution not found.');
    }

    let sessions = await this.prisma.academicSession.findMany({
      where: { schoolId },
      include: {
        terms: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ isCurrent: 'desc' }, { name: 'desc' }, { createdAt: 'desc' }],
    });

    const extractSessionStartYear = (name: string): number => {
      const m = String(name || '').match(/(19|20)\d{2}/);
      return m ? parseInt(m[0], 10) : 0;
    };
    sessions.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      const ya = extractSessionStartYear(a.name);
      const yb = extractSessionStartYear(b.name);
      if (ya !== yb) return yb - ya;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const hasAnyTerms = sessions.some((s) => s.terms.length > 0);
    if (!hasAnyTerms) {
      const isTertiary = this.isTertiaryInstitution(school.institutionType);
      const termNames = isTertiary
        ? ['First Semester', 'Second Semester']
        : ['First Term', 'Second Term', 'Third Term'];

      const createdSession = await this.prisma.academicSession.create({
        data: {
          schoolId,
          name: '2025/2026 Academic Session',
          isCurrent: true,
          terms: {
            create: termNames.map((name, idx) => ({
              name,
              isCurrent: idx === 0,
            })),
          },
        },
        include: {
          terms: { orderBy: { createdAt: 'asc' } },
        },
      });
      sessions = [createdSession];
    }

    const termIds = sessions.flatMap((s) => s.terms.map((t) => t.id));
    const gradeCounts =
      termIds.length > 0
        ? await this.prisma.studentSubjectGrade.groupBy({
            by: ['termId'],
            where: { termId: { in: termIds } },
            _count: { _all: true },
          })
        : [];
    const countMap = new Map(
      gradeCounts.map((gc) => [gc.termId, gc._count._all]),
    );

    const formattedSessions = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      isCurrent: s.isCurrent,
      terms: s.terms.map((t) => ({
        id: t.id,
        name: t.name,
        sessionId: s.id,
        sessionName: s.name,
        isCurrent: t.isCurrent,
        recordedCount: countMap.get(t.id) ?? 0,
      })),
    }));

    const terms = formattedSessions.flatMap((s) => s.terms);
    const activeTerm = terms.find((t) => t.isCurrent) ?? terms[0];
    return { activeTerm, terms, sessions: formattedSessions };
  }

  private async verifySchoolAdminAccess(userId: string, schoolId: string) {
    const [school, user] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, institutionType: true },
      }),
      userId
        ? this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, schoolId: true },
          })
        : Promise.resolve(null),
    ]);

    if (!school) {
      throw new NotFoundException('Institution not found.');
    }
    if (
      user &&
      user.role !== 'SUPER_ADMIN' &&
      user.schoolId &&
      user.schoolId !== schoolId
    ) {
      throw new ForbiddenException('Access denied to another institution.');
    }
    return school;
  }

  async createSchoolSession(
    userId: string,
    schoolId: string,
    dto: { name: string; makeCurrent?: boolean; customTerms?: string[] },
  ) {
    const cleanName = String(dto.name || '').trim();
    if (!cleanName) {
      throw new BadRequestException(
        'Academic session name is required (e.g. 2017/2018 or 2025/2026).',
      );
    }

    const school = await this.verifySchoolAdminAccess(userId, schoolId);

    const existing = await this.prisma.academicSession.findFirst({
      where: {
        schoolId,
        name: { equals: cleanName, mode: 'insensitive' },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Academic session "${existing.name}" already exists for this school.`,
      );
    }

    const makeCurrent = dto.makeCurrent !== false;
    if (makeCurrent) {
      await this.prisma.academicSession.updateMany({
        where: { schoolId },
        data: { isCurrent: false },
      });
      await this.prisma.academicTerm.updateMany({
        where: { session: { schoolId } },
        data: { isCurrent: false },
      });
    }

    const isTertiary = this.isTertiaryInstitution(school.institutionType);
    const defaultTermNames = isTertiary
      ? ['First Semester', 'Second Semester']
      : ['First Term', 'Second Term', 'Third Term'];
    const customList = Array.isArray(dto.customTerms)
      ? dto.customTerms.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const termNames = customList.length > 0 ? customList : defaultTermNames;

    const session = await this.prisma.academicSession.create({
      data: {
        schoolId,
        name: cleanName,
        isCurrent: makeCurrent,
        terms: {
          create: termNames.map((name, idx) => ({
            name,
            isCurrent: makeCurrent && idx === 0,
          })),
        },
      },
      include: { terms: { orderBy: { createdAt: 'asc' } } },
    });

    const all = await this.ensureDefaultTerms(schoolId);
    return {
      session,
      ...all,
      message: `Created ${cleanName} with ${termNames.length} ${isTertiary ? 'semesters' : 'terms'}.`,
    };
  }

  async createSchoolTerm(
    userId: string,
    schoolId: string,
    sessionId: string,
    dto: { name: string; makeCurrent?: boolean },
  ) {
    const cleanName = String(dto.name || '').trim();
    if (!cleanName) {
      throw new BadRequestException(
        'Term / semester name is required (e.g. Third Term or Summer Semester).',
      );
    }

    await this.verifySchoolAdminAccess(userId, schoolId);

    const session = await this.prisma.academicSession.findFirst({
      where: { id: sessionId, schoolId },
      include: { terms: true },
    });
    if (!session) {
      throw new NotFoundException('Academic session not found for this school.');
    }

    if (
      session.terms.some(
        (t) => t.name.toLowerCase() === cleanName.toLowerCase(),
      )
    ) {
      throw new BadRequestException(
        `"${cleanName}" already exists in ${session.name}.`,
      );
    }

    const makeCurrent = dto.makeCurrent === true;
    if (makeCurrent) {
      await this.prisma.academicSession.updateMany({
        where: { schoolId },
        data: { isCurrent: false },
      });
      await this.prisma.academicSession.update({
        where: { id: session.id },
        data: { isCurrent: true },
      });
      await this.prisma.academicTerm.updateMany({
        where: { session: { schoolId } },
        data: { isCurrent: false },
      });
    }

    const term = await this.prisma.academicTerm.create({
      data: {
        sessionId: session.id,
        name: cleanName,
        isCurrent: makeCurrent,
      },
    });

    const all = await this.ensureDefaultTerms(schoolId);
    return {
      term,
      ...all,
      message: `Added "${cleanName}" to ${session.name}.`,
    };
  }

  async setActiveTerm(userId: string, schoolId: string, termId: string) {
    await this.verifySchoolAdminAccess(userId, schoolId);

    const term = await this.prisma.academicTerm.findFirst({
      where: {
        id: termId,
        session: { schoolId },
      },
      include: { session: true },
    });
    if (!term) {
      throw new NotFoundException('Academic term not found for this school.');
    }

    await this.prisma.$transaction([
      this.prisma.academicSession.updateMany({
        where: { schoolId },
        data: { isCurrent: false },
      }),
      this.prisma.academicTerm.updateMany({
        where: { session: { schoolId } },
        data: { isCurrent: false },
      }),
      this.prisma.academicSession.update({
        where: { id: term.sessionId },
        data: { isCurrent: true },
      }),
      this.prisma.academicTerm.update({
        where: { id: term.id },
        data: { isCurrent: true },
      }),
    ]);

    const all = await this.ensureDefaultTerms(schoolId);
    return {
      ...all,
      message: `Active session set to ${term.session.name} (${term.name}).`,
    };
  }

  private async resolveTermForSchool(schoolId: string, termId?: string) {
    const { activeTerm, terms, sessions } = await this.ensureDefaultTerms(schoolId);
    if (termId) {
      const matched = terms.find((t) => t.id === termId);
      if (!matched) {
        throw new BadRequestException('Selected academic term does not belong to this school.');
      }
      return { term: matched, terms, sessions };
    }
    return { term: activeTerm, terms, sessions };
  }

  private async verifySubjectAccess(userId: string | undefined, subjectId: string) {
    const subject = await this.prisma.schoolSubject.findUnique({
      where: { id: subjectId },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            institutionType: true,
          },
        },
        schoolClass: {
          select: {
            id: true,
            name: true,
            levelCode: true,
            formTeacherId: true,
          },
        },
        department: {
          select: { id: true, name: true, code: true },
        },
        assignedTeachers: {
          select: { id: true, userId: true },
        },
      },
    });

    if (!subject) {
      throw new NotFoundException('Course / Subject not found.');
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, schoolId: true },
      });

      if (user?.role === 'SCHOOL_ADMIN' && user.schoolId && user.schoolId !== subject.schoolId) {
        throw new ForbiddenException('Access denied: Subject belongs to another institution.');
      }

      if (user?.role === 'TEACHER') {
        const isDirectTeacher = subject.teacherId === userId;
        const isAssignedProfile = subject.assignedTeachers.some((t) => t.userId === userId);
        const isFormTeacher = subject.schoolClass.formTeacherId === userId;
        const isAssignedClassTeacher = await this.prisma.teacherProfile.findFirst({
          where: {
            userId,
            assignedClasses: { some: { id: subject.classId } },
          },
          select: { id: true },
        });

        if (!isDirectTeacher && !isAssignedProfile && !isFormTeacher && !isAssignedClassTeacher) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to grade this course/subject.',
          );
        }
      }
    }

    return subject;
  }

  private async verifyClassAccess(userId: string | undefined, classId: string) {
    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: classId },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            institutionType: true,
            defaultMinAttendancePercent: true,
          },
        },
        department: { select: { id: true, name: true, code: true } },
        subjects: {
          orderBy: { name: 'asc' },
          include: {
            assignedTeachers: { select: { userId: true } },
          },
        },
      },
    });

    if (!schoolClass) {
      throw new NotFoundException('Class / Level not found.');
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, schoolId: true },
      });

      if (user?.role === 'SCHOOL_ADMIN' && user.schoolId && user.schoolId !== schoolClass.schoolId) {
        throw new ForbiddenException('Access denied: Class belongs to another institution.');
      }

      if (user?.role === 'TEACHER') {
        const isFormTeacher = schoolClass.formTeacherId === userId;
        const teachesAnySubject = schoolClass.subjects.some(
          (sub) =>
            sub.teacherId === userId ||
            sub.assignedTeachers.some((t) => t.userId === userId),
        );
        const isAssignedClassTeacher = await this.prisma.teacherProfile.findFirst({
          where: {
            userId,
            assignedClasses: { some: { id: classId } },
          },
          select: { id: true },
        });

        if (!isFormTeacher && !teachesAnySubject && !isAssignedClassTeacher) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to this class broadsheet.',
          );
        }
      }
    }

    return schoolClass;
  }

  private async getEnrolledStudentsForClass(schoolId: string, classId: string) {
    const [profiles, directUsers] = await Promise.all([
      this.prisma.studentProfile.findMany({
        where: { classId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
              studentCode: true,
              loginId: true,
            },
          },
        },
        orderBy: { user: { fullName: 'asc' } },
      }),
      this.prisma.user.findMany({
        where: { schoolId, classId, role: 'STUDENT' },
        select: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
          studentCode: true,
          loginId: true,
        },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    const studentMap = new Map<
      string,
      {
        studentId: string;
        fullName: string;
        email: string;
        avatarUrl: string | null;
        matricOrAdmissionNo: string;
      }
    >();

    for (const p of profiles) {
      if (!p.user) continue;
      studentMap.set(p.user.id, {
        studentId: p.user.id,
        fullName: p.user.fullName ?? 'Student',
        email: p.user.email ?? '',
        avatarUrl: p.user.avatarUrl ?? null,
        matricOrAdmissionNo:
          p.matricOrAdmissionNo || p.user.loginId || p.user.studentCode || 'N/A',
      });
    }

    for (const u of directUsers) {
      if (!studentMap.has(u.id)) {
        studentMap.set(u.id, {
          studentId: u.id,
          fullName: u.fullName ?? 'Student',
          email: u.email ?? '',
          avatarUrl: u.avatarUrl ?? null,
          matricOrAdmissionNo: u.loginId || u.studentCode || 'N/A',
        });
      }
    }

    return Array.from(studentMap.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    );
  }

  async resolveAssessmentConfig(
    schoolId: string,
    subjectId?: string,
    institutionType?: string | null,
  ) {
    const subjectOverride = subjectId
      ? await this.prisma.assessmentConfig.findUnique({ where: { subjectId } })
      : null;

    const schoolConfig = await this.prisma.assessmentConfig.findFirst({
      where: { schoolId, subjectId: null },
    });

    const configRecord = subjectOverride ?? schoolConfig;
    const gpaScaleMax = configRecord?.gpaScaleMax ?? 5.0;

    const scheme = this.rankingCalculator.normalizeStoredComponents(
      configRecord?.componentsJson,
      institutionType,
    );

    const gradeScale: GradeScaleBand[] =
      configRecord && Array.isArray(configRecord.gradeScaleJson)
        ? (configRecord.gradeScaleJson as unknown as GradeScaleBand[])
        : this.gpaCalculator.getDefaultScale(institutionType, gpaScaleMax);

    return {
      caMode: scheme.caMode,
      caWeightTotal: scheme.caWeightTotal,
      examWeightTotal: scheme.examWeightTotal,
      components: scheme.components,
      gradeScale,
      gpaScaleMax,
      totalMaxWeight: scheme.components.reduce(
        (acc, c) => acc + Number(c.maxScore || 0),
        0,
      ),
      isSubjectOverride: Boolean(subjectOverride),
      hasSchoolConfig: Boolean(schoolConfig),
    };
  }

  private validateAndSanitizeScheme(
    dto: UpsertConfigInput,
    institutionType?: string | null,
  ) {
    if (!Array.isArray(dto.components) || dto.components.length === 0) {
      throw new BadRequestException(
        'At least one assessment column (CA Test / Exam) is required.',
      );
    }

    const usedKeys = new Set<string>();
    const cleanComponents: AssessmentComponentConfig[] = dto.components.map(
      (c, idx) => {
        let baseKey =
          (c.key || c.label || `comp_${idx + 1}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '') || `comp_${idx + 1}`;
        while (usedKeys.has(baseKey)) {
          baseKey = `${baseKey}_${idx + 1}`;
        }
        usedKeys.add(baseKey);
        const role = this.rankingCalculator.inferComponentRole(c);
        return {
          key: baseKey,
          label: (c.label || `Component ${idx + 1}`).trim(),
          maxScore: Math.max(1, Math.min(100, Number(c.maxScore) || 0)),
          role,
          isOptional: role === 'CA' ? Boolean(c.isOptional) : false,
        };
      },
    );

    const fallback = this.rankingCalculator.getDefaultScheme(institutionType);
    const caMode: CaCalculationMode =
      dto.caMode === 'DIRECT_SUM' ? 'DIRECT_SUM' : 'CA_POOL_SCALED';

    let caWeightTotal =
      typeof dto.caWeightTotal === 'number'
        ? Math.max(0, Math.min(100, Math.round(dto.caWeightTotal)))
        : fallback.caWeightTotal;
    let examWeightTotal =
      typeof dto.examWeightTotal === 'number'
        ? Math.max(0, Math.min(100, Math.round(dto.examWeightTotal)))
        : 100 - caWeightTotal;

    if (caMode === 'DIRECT_SUM') {
      const weightSum = cleanComponents.reduce((acc, c) => acc + c.maxScore, 0);
      if (weightSum !== 100) {
        throw new BadRequestException(
          `In Fixed Weights mode, columns must add up to 100% (currently ${weightSum}%). Switch to Flexible CA Scaling to add any number of CA tests freely.`,
        );
      }
      examWeightTotal = cleanComponents
        .filter((c) => c.role === 'EXAM')
        .reduce((acc, c) => acc + c.maxScore, 0);
      caWeightTotal = 100 - examWeightTotal;
    } else {
      if (caWeightTotal + examWeightTotal !== 100) {
        throw new BadRequestException(
          `CA Weight (${caWeightTotal}%) + Exam Weight (${examWeightTotal}%) must equal 100%.`,
        );
      }
    }

    return {
      caMode,
      caWeightTotal,
      examWeightTotal,
      components: cleanComponents,
    };
  }

  private validateGradeScale(
    gradeScale: GradeScaleBand[] | undefined,
    institutionType?: string | null,
    gpaScaleMax = 5.0,
  ): GradeScaleBand[] {
    if (!Array.isArray(gradeScale) || gradeScale.length === 0) {
      return this.gpaCalculator.getDefaultScale(institutionType, gpaScaleMax);
    }
    const clean = gradeScale
      .map((band) => ({
        min: Math.max(0, Math.min(100, Number(band.min) || 0)),
        max: Math.max(0, Math.min(100, Number(band.max ?? 100) || 100)),
        grade: String(band.grade || 'F').trim().toUpperCase(),
        point: Math.max(0, Math.min(gpaScaleMax, Number(band.point) || 0)),
        remark: band.remark ? String(band.remark).trim() : '',
      }))
      .sort((a, b) => b.min - a.min);

    return clean.map((b, i) => ({
      ...b,
      max: i === 0 ? 100 : Math.max(b.min, Number((clean[i - 1].min - 0.01).toFixed(2))),
    }));
  }

  /**
   * School-wide Grading Settings (for Principal / School Admin)
   */
  async getSchoolAssessmentConfig(userId: string, schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, institutionType: true },
    });
    if (!school) {
      throw new NotFoundException('Institution not found.');
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, schoolId: true },
      });
      if (
        user &&
        user.role !== 'SUPER_ADMIN' &&
        user.schoolId &&
        user.schoolId !== schoolId
      ) {
        throw new ForbiddenException('Access denied to another institution settings.');
      }
    }

    const [config, subjectOverridesCount] = await Promise.all([
      this.resolveAssessmentConfig(schoolId, undefined, school.institutionType),
      this.prisma.assessmentConfig.count({
        where: { schoolId, subjectId: { not: null } },
      }),
    ]);

    return {
      school: {
        id: school.id,
        name: school.name,
        institutionType: school.institutionType,
        isTertiary: this.isTertiaryInstitution(school.institutionType),
      },
      config,
      subjectOverridesCount,
    };
  }

  async upsertSchoolAssessmentConfig(
    userId: string,
    schoolId: string,
    dto: UpsertConfigInput,
  ) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, institutionType: true },
    });
    if (!school) {
      throw new NotFoundException('Institution not found.');
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, schoolId: true },
      });
      if (
        user &&
        user.role !== 'SUPER_ADMIN' &&
        user.schoolId &&
        user.schoolId !== schoolId
      ) {
        throw new ForbiddenException('Access denied to another institution settings.');
      }
    }

    const cleanScheme = this.validateAndSanitizeScheme(dto, school.institutionType);
    const gpaScaleMax = dto.gpaScaleMax === 4 ? 4.0 : 5.0;
    const resolvedScale = this.validateGradeScale(
      dto.gradeScale,
      school.institutionType,
      gpaScaleMax,
    );

    const existingSchoolDefault = await this.prisma.assessmentConfig.findFirst({
      where: { schoolId, subjectId: null },
    });

    const saved = existingSchoolDefault
      ? await this.prisma.assessmentConfig.update({
          where: { id: existingSchoolDefault.id },
          data: {
            componentsJson: cleanScheme as any,
            gradeScaleJson: resolvedScale as any,
            gpaScaleMax,
          },
        })
      : await this.prisma.assessmentConfig.create({
          data: {
            schoolId,
            subjectId: null,
            componentsJson: cleanScheme as any,
            gradeScaleJson: resolvedScale as any,
            gpaScaleMax,
          },
        });

    if (dto.overrideSubjects) {
      await this.prisma.assessmentConfig.deleteMany({
        where: { schoolId, subjectId: { not: null } },
      });
    }

    const updatedConfig = await this.resolveAssessmentConfig(
      schoolId,
      undefined,
      school.institutionType,
    );

    return {
      message: dto.overrideSubjects
        ? 'School grading scheme updated and applied across all subjects/courses.'
        : 'School default grading scheme updated successfully.',
      config: updatedConfig,
    };
  }

  async upsertAssessmentConfig(
    userId: string,
    subjectId: string,
    dto: UpsertConfigInput,
  ) {
    const subject = await this.verifySubjectAccess(userId, subjectId);

    if (dto.resetToSchoolDefault) {
      await this.prisma.assessmentConfig.deleteMany({
        where: { subjectId },
      });
    } else {
      const cleanScheme = this.validateAndSanitizeScheme(
        dto,
        subject.school.institutionType,
      );
      const gpaScaleMax = dto.gpaScaleMax === 4 ? 4.0 : 5.0;
      const resolvedScale = this.validateGradeScale(
        dto.gradeScale,
        subject.school.institutionType,
        gpaScaleMax,
      );

      await this.prisma.assessmentConfig.upsert({
        where: { subjectId },
        create: {
          schoolId: subject.schoolId,
          subjectId,
          componentsJson: cleanScheme as any,
          gradeScaleJson: resolvedScale as any,
          gpaScaleMax,
        },
        update: {
          componentsJson: cleanScheme as any,
          gradeScaleJson: resolvedScale as any,
          gpaScaleMax,
        },
      });

      if (dto.applyToSchool) {
        await this.upsertSchoolAssessmentConfig(userId, subject.schoolId, {
          ...dto,
          components: cleanScheme.components,
          caMode: cleanScheme.caMode,
          caWeightTotal: cleanScheme.caWeightTotal,
          examWeightTotal: cleanScheme.examWeightTotal,
          gradeScale: resolvedScale,
          gpaScaleMax,
        });
      }
    }

    const updatedConfig = await this.resolveAssessmentConfig(
      subject.schoolId,
      subjectId,
      subject.school.institutionType,
    );

    // Recompute any existing saved scores in the current term under the updated slots/weights
    const { term } = await this.resolveTermForSchool(subject.schoolId);
    await this.recomputeAndRankSubjectTerm(this.prisma, subject, term.id, updatedConfig);

    return {
      message: dto.resetToSchoolDefault
        ? 'Reverted course/subject to school default grading scheme.'
        : 'Grading setup updated and existing scores recalculated.',
      config: updatedConfig,
    };
  }

  private async recomputeAndRankSubjectTerm(
    db: any,
    subject: { id: string; schoolId: string; school: { institutionType: string | null } },
    termId: string,
    config: Awaited<ReturnType<AssessmentsGradingService['resolveAssessmentConfig']>>,
  ) {
    const allSubjectGrades = await db.studentSubjectGrade.findMany({
      where: { termId, subjectId: subject.id },
      select: { id: true, studentId: true, scoresJson: true },
    });

    if (allSubjectGrades.length === 0) return;

    // Collect every component key that actually has a score entered anywhere in this class
    const activeSlotKeys = new Set<string>();
    for (const row of allSubjectGrades) {
      const sj = (row.scoresJson as Record<string, any>) ?? {};
      for (const comp of config.components) {
        const val = sj[comp.key];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          activeSlotKeys.add(comp.key);
        }
      }
    }

    const computedRows: Array<{
      id: string;
      studentId: string;
      totalScore: number;
      letterGrade: string;
      gradePoint: number;
      sanitizedScores: Record<string, number | null>;
    }> = [];

    for (const row of allSubjectGrades) {
      const { sanitizedScores, totalScore } = this.rankingCalculator.computeComponentTotal(
        row.scoresJson as Record<string, any>,
        config.components,
        {
          caMode: config.caMode,
          caWeightTotal: config.caWeightTotal,
          examWeightTotal: config.examWeightTotal,
          activeSlotKeys,
        },
      );
      const band = this.gpaCalculator.resolveGradeBand(
        totalScore,
        config.gradeScale,
        config.gpaScaleMax,
        subject.school.institutionType,
      );
      computedRows.push({
        id: row.id,
        studentId: row.studentId,
        totalScore,
        letterGrade: band.grade,
        gradePoint: band.point,
        sanitizedScores,
      });
    }

    const ranked = this.rankingCalculator.rankStudentsWithTies(
      computedRows.map((r) => ({ studentId: r.studentId, totalScore: r.totalScore })),
      {
        customScale: config.gradeScale,
        scaleMax: config.gpaScaleMax,
        schoolType: subject.school.institutionType,
      },
    );
    const rankedByStudent = new Map(ranked.map((r) => [r.studentId, r]));

    for (const r of computedRows) {
      const rank = rankedByStudent.get(r.studentId);
      await db.studentSubjectGrade.update({
        where: { id: r.id },
        data: {
          scoresJson: r.sanitizedScores as any,
          totalScore: r.totalScore,
          letterGrade: r.letterGrade,
          gradePoint: r.gradePoint,
          subjectPosition: rank?.positionNumber ?? null,
          subjectOrdinal: rank?.positionOrdinal ?? null,
        },
      });
    }
  }

  /**
   * Teacher Gradebook Sheet for a specific Subject + Academic Term
   */
  async getSubjectGradebook(userId: string, subjectId: string, termId?: string) {
    const subject = await this.verifySubjectAccess(userId, subjectId);
    const { term, terms, sessions: schoolSessions } =
      await this.resolveTermForSchool(subject.schoolId, termId);
    const config = await this.resolveAssessmentConfig(
      subject.schoolId,
      subject.id,
      subject.school.institutionType,
    );

    const [enrolledStudents, existingGrades, sessions, availableCbts] = await Promise.all([
      this.getEnrolledStudentsForClass(subject.schoolId, subject.classId),
      this.prisma.studentSubjectGrade.findMany({
        where: { termId: term.id, subjectId: subject.id },
      }),
      this.prisma.attendanceSession.findMany({
        where: { subjectId: subject.id },
        include: {
          records: { select: { studentId: true, status: true } },
        },
      }),
      this.prisma.quiz.findMany({
        where: {
          schoolId: subject.schoolId,
          OR: [
            { subjectId: subject.id },
            { classId: subject.classId, isClassCbt: true },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          courseCode: true,
          totalPossibleMarks: true,
          createdAt: true,
          _count: { select: { cbtSubmissions: true } },
        },
      }),
    ]);

    const gradeByStudent = new Map(existingGrades.map((g) => [g.studentId, g]));
    const totalLectures = sessions.length;

    const rows = enrolledStudents.map((student) => {
      const saved = gradeByStudent.get(student.studentId);
      let attendedCount = 0;
      if (totalLectures > 0) {
        for (const s of sessions) {
          const rec = s.records.find((r) => r.studentId === student.studentId);
          if (rec && (rec.status === 'PRESENT' || rec.status === 'LATE' || rec.status === 'EXCUSED')) {
            attendedCount += 1;
          }
        }
      }
      const attendancePercent =
        totalLectures > 0 ? Math.round((attendedCount / totalLectures) * 100) : 100;

      const scoresMap: Record<string, number> = {};
      if (saved) {
        const savedJson = (saved.scoresJson as Record<string, any>) ?? {};
        for (const comp of config.components) {
          if (savedJson[comp.key] !== undefined && savedJson[comp.key] !== null) {
            scoresMap[comp.key] = Number(savedJson[comp.key]);
          }
        }
      }

      return {
        studentId: student.studentId,
        fullName: student.fullName,
        matricOrAdmissionNo: student.matricOrAdmissionNo,
        avatarUrl: student.avatarUrl,
        attendancePercent,
        scores: scoresMap,
        totalScore: saved?.totalScore ?? 0,
        letterGrade: saved?.letterGrade ?? '-',
        gradePoint: saved?.gradePoint ?? 0,
        subjectPosition: saved?.subjectPosition ?? null,
        subjectOrdinal: saved?.subjectOrdinal ?? null,
        teacherComment: saved?.teacherComment ?? '',
        hasSavedRecord: Boolean(saved),
      };
    });

    const gradedScores = rows.filter((r) => r.hasSavedRecord).map((r) => r.totalScore);
    const classAverage =
      gradedScores.length > 0
        ? Math.round(
            (gradedScores.reduce((a, b) => a + b, 0) / gradedScores.length) * 100,
          ) / 100
        : 0;

    return {
      subject: {
        id: subject.id,
        name: subject.name,
        courseCode: subject.courseCode,
        creditUnits: subject.creditUnits,
        classId: subject.classId,
        className: subject.schoolClass.name,
        schoolId: subject.schoolId,
        schoolName: subject.school.name,
        institutionType: subject.school.institutionType,
        isTertiary: this.isTertiaryInstitution(subject.school.institutionType),
      },
      term,
      terms,
      sessions: schoolSessions,
      config,
      stats: {
        totalStudents: rows.length,
        gradedCount: gradedScores.length,
        classAverage,
        highestScore: gradedScores.length > 0 ? Math.max(...gradedScores) : 0,
      },
      availableCbts: availableCbts.map((q) => ({
        id: q.id,
        title: q.title,
        courseCode: q.courseCode,
        totalPossibleMarks: q.totalPossibleMarks,
        submissionCount: q._count.cbtSubmissions,
        createdAt: q.createdAt,
      })),
      students: rows,
    };
  }

  /**
   * Bulk Save / Upsert Scores for a Subject + Recompute Subject Positions & Class Broadsheet
   */
  async saveSubjectGrades(
    userId: string,
    subjectId: string,
    dto: { termId?: string; entries: SaveGradeEntryInput[] },
  ) {
    const subject = await this.verifySubjectAccess(userId, subjectId);
    const { term } = await this.resolveTermForSchool(subject.schoolId, dto.termId);
    const config = await this.resolveAssessmentConfig(
      subject.schoolId,
      subject.id,
      subject.school.institutionType,
    );

    if (!Array.isArray(dto.entries) || dto.entries.length === 0) {
      throw new BadRequestException('No student score entries provided.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.entries) {
        await tx.studentSubjectGrade.upsert({
          where: {
            termId_subjectId_studentId: {
              termId: term.id,
              subjectId: subject.id,
              studentId: entry.studentId,
            },
          },
          create: {
            schoolId: subject.schoolId,
            termId: term.id,
            classId: subject.classId,
            subjectId: subject.id,
            studentId: entry.studentId,
            scoresJson: entry.scores as any,
            totalScore: 0,
            letterGrade: 'F',
            gradePoint: 0,
            teacherComment: entry.teacherComment?.trim() || null,
          },
          update: {
            scoresJson: entry.scores as any,
            teacherComment:
              entry.teacherComment !== undefined
                ? entry.teacherComment.trim() || null
                : undefined,
          },
        });
      }

      // Evaluate totals with optional/unused CA slot awareness + tie-aware ranking across cohort
      await this.recomputeAndRankSubjectTerm(tx, subject, term.id, config);
    });

    // Keep class TerminalReportCard broadsheet & GPA/CGPA synchronized
    await this.computeClassBroadsheetAndPositions(subject.classId, term.id, userId);

    const updated = await this.getSubjectGradebook(userId, subject.id, term.id);
    return {
      message: `Saved ${dto.entries.length} student grade(s) and updated class positions.`,
      ...updated,
    };
  }

  /**
   * 1-Tap Import CBT Quiz Scores into a Target CA Component
   */
  async importCbtScoresToGradebook(
    userId: string,
    subjectId: string,
    dto: { quizId: string; targetComponentKey?: string; termId?: string },
  ) {
    const subject = await this.verifySubjectAccess(userId, subjectId);
    const { term } = await this.resolveTermForSchool(subject.schoolId, dto.termId);
    const config = await this.resolveAssessmentConfig(
      subject.schoolId,
      subject.id,
      subject.school.institutionType,
    );

    const quiz = await this.prisma.quiz.findUnique({
      where: { id: dto.quizId },
      include: {
        cbtSubmissions: true,
      },
    });

    if (!quiz) {
      throw new NotFoundException('CBT Quiz not found.');
    }

    if (quiz.schoolId && quiz.schoolId !== subject.schoolId) {
      throw new ForbiddenException('CBT Quiz belongs to another institution.');
    }

    const targetComp =
      config.components.find((c) => c.key === dto.targetComponentKey) ||
      config.components.find((c) => c.key === 'ca2') ||
      config.components.find((c) => c.key !== 'exam') ||
      config.components[0];

    if (!targetComp) {
      throw new BadRequestException('No target assessment component available.');
    }

    if (quiz.cbtSubmissions.length === 0) {
      throw new BadRequestException('No student CBT submissions found for this quiz yet.');
    }

    const existingGrades = await this.prisma.studentSubjectGrade.findMany({
      where: { termId: term.id, subjectId: subject.id },
    });
    const existingByStudent = new Map(existingGrades.map((g) => [g.studentId, g]));

    const entries: SaveGradeEntryInput[] = quiz.cbtSubmissions.map((sub) => {
      const prevScores = {
        ...((existingByStudent.get(sub.studentId)?.scoresJson as Record<string, number>) ?? {}),
      };
      const scaled =
        Math.round(((Number(sub.percentage) || 0) / 100) * targetComp.maxScore * 10) / 10;
      prevScores[targetComp.key] = scaled;
      return {
        studentId: sub.studentId,
        scores: prevScores,
      };
    });

    const result = await this.saveSubjectGrades(userId, subjectId, {
      termId: term.id,
      entries,
    });

    return {
      ...result,
      importedCount: entries.length,
      importedIntoComponent: targetComp,
      message: `Imported ${entries.length} CBT score(s) into "${targetComp.label}" (max ${targetComp.maxScore}) and updated rankings.`,
    };
  }

  /**
   * Compute Master Class Broadsheet (Secondary 1st/2nd/3rd) + Senate Summary (Tertiary GPA/CGPA)
   */
  async computeClassBroadsheetAndPositions(
    classId: string,
    termId?: string,
    userId?: string,
  ) {
    const schoolClass = await this.verifyClassAccess(userId, classId);
    const { term, terms, sessions } = await this.resolveTermForSchool(schoolClass.schoolId, termId);
    const config = await this.resolveAssessmentConfig(
      schoolClass.schoolId,
      undefined,
      schoolClass.school.institutionType,
    );
    const isTertiary = this.isTertiaryInstitution(schoolClass.school.institutionType);

    const enrolledStudents = await this.getEnrolledStudentsForClass(
      schoolClass.schoolId,
      schoolClass.id,
    );
    const studentIds = enrolledStudents.map((s) => s.studentId);

    const [termGrades, allStudentGrades, classAttendanceSessions, existingReportCards] =
      await Promise.all([
        this.prisma.studentSubjectGrade.findMany({
          where: { termId: term.id, classId: schoolClass.id },
          include: {
            subject: { select: { id: true, creditUnits: true } },
          },
        }),
        studentIds.length > 0
          ? this.prisma.studentSubjectGrade.findMany({
              where: {
                schoolId: schoolClass.schoolId,
                studentId: { in: studentIds },
              },
              include: {
                subject: { select: { id: true, creditUnits: true } },
              },
            })
          : Promise.resolve([]),
        this.prisma.attendanceSession.findMany({
          where: { classId: schoolClass.id },
          include: {
            records: { select: { studentId: true, status: true } },
          },
        }),
        this.prisma.terminalReportCard.findMany({
          where: { termId: term.id, classId: schoolClass.id },
        }),
      ]);

    const reportCardByStudent = new Map(
      existingReportCards.map((rc) => [rc.studentId, rc]),
    );
    const minAttendanceCutoff =
      schoolClass.school.defaultMinAttendancePercent ?? 75;
    const totalClassSessions = classAttendanceSessions.length;

    // Build preliminary student aggregates
    const preliminary = enrolledStudents.map((student) => {
      const studentTermGrades = termGrades.filter(
        (g) => g.studentId === student.studentId,
      );
      const studentCumulativeGrades = allStudentGrades.filter(
        (g) => g.studentId === student.studentId,
      );

      const subjectScores: Record<
        string,
        {
          totalScore: number;
          letterGrade: string;
          gradePoint: number;
          subjectPosition: number | null;
          subjectOrdinal: string | null;
        }
      > = {};

      let totalScoreSum = 0;
      for (const g of studentTermGrades) {
        totalScoreSum += Number(g.totalScore) || 0;
        subjectScores[g.subjectId] = {
          totalScore: g.totalScore,
          letterGrade: g.letterGrade,
          gradePoint: g.gradePoint,
          subjectPosition: g.subjectPosition,
          subjectOrdinal: g.subjectOrdinal,
        };
      }

      const gradedCount = studentTermGrades.length;
      const overallAverage =
        gradedCount > 0
          ? Math.round((totalScoreSum / gradedCount) * 100) / 100
          : 0;

      const termGpaSummary = this.gpaCalculator.calculateTermGpa(
        studentTermGrades.map((g) => ({
          creditUnits: g.subject?.creditUnits ?? 3,
          totalScore: g.totalScore,
          gradePoint: g.gradePoint,
        })),
        config.gpaScaleMax,
      );

      const cumulativeSummary = this.gpaCalculator.calculateCumulativeCgpa(
        studentCumulativeGrades.map((g) => ({
          creditUnits: g.subject?.creditUnits ?? 3,
          totalScore: g.totalScore,
          gradePoint: g.gradePoint,
        })),
        config.gpaScaleMax,
      );

      let attendedCount = 0;
      if (totalClassSessions > 0) {
        for (const sess of classAttendanceSessions) {
          const rec = sess.records.find((r) => r.studentId === student.studentId);
          if (rec && (rec.status === 'PRESENT' || rec.status === 'LATE' || rec.status === 'EXCUSED')) {
            attendedCount += 1;
          }
        }
      }
      const attendancePercent =
        totalClassSessions > 0
          ? Math.round((attendedCount / totalClassSessions) * 100)
          : 100;

      return {
        student,
        gradedCount,
        subjectScores,
        totalScore: Math.round(totalScoreSum * 100) / 100,
        overallAverage,
        termGpaSummary,
        cumulativeSummary,
        attendancePercent,
        examEligible: attendancePercent >= minAttendanceCutoff,
      };
    });

    // Rank graded students for Secondary/Primary overall class position (1st, 2nd, 3rd with ties)
    const gradedCandidates = preliminary
      .filter((p) => p.gradedCount > 0)
      .map((p) => ({
        studentId: p.student.studentId,
        totalScore: p.overallAverage,
      }));

    const overallRanked = this.rankingCalculator.rankStudentsWithTies(gradedCandidates, {
      customScale: config.gradeScale,
      scaleMax: config.gpaScaleMax,
      schoolType: schoolClass.school.institutionType,
    });
    const overallRankByStudent = new Map(overallRanked.map((r) => [r.studentId, r]));

    // Persist TerminalReportCard + StudentProfile CGPA snapshot
    await this.prisma.$transaction(async (tx) => {
      for (const item of preliminary) {
        const rank = overallRankByStudent.get(item.student.studentId);
        const existingRc = reportCardByStudent.get(item.student.studentId);

        await tx.terminalReportCard.upsert({
          where: {
            termId_classId_studentId: {
              termId: term.id,
              classId: schoolClass.id,
              studentId: item.student.studentId,
            },
          },
          create: {
            schoolId: schoolClass.schoolId,
            termId: term.id,
            classId: schoolClass.id,
            studentId: item.student.studentId,
            totalScore: item.totalScore,
            overallAverage: item.overallAverage,
            gpa: item.gradedCount > 0 ? item.termGpaSummary.gpa : null,
            cgpa: item.cumulativeSummary.totalUnits > 0 ? item.cumulativeSummary.gpa : null,
            overallPosition: rank?.positionNumber ?? null,
            overallOrdinal: rank?.positionOrdinal ?? null,
            attendancePercent: item.attendancePercent,
            examEligible: item.examEligible,
            published: existingRc?.published ?? false,
          },
          update: {
            totalScore: item.totalScore,
            overallAverage: item.overallAverage,
            gpa: item.gradedCount > 0 ? item.termGpaSummary.gpa : null,
            cgpa: item.cumulativeSummary.totalUnits > 0 ? item.cumulativeSummary.gpa : null,
            overallPosition: rank?.positionNumber ?? null,
            overallOrdinal: rank?.positionOrdinal ?? null,
            attendancePercent: item.attendancePercent,
            examEligible: item.examEligible,
          },
        });

        await tx.studentProfile.updateMany({
          where: { userId: item.student.studentId },
          data: {
            cgpa: item.cumulativeSummary.gpa,
            totalCredits: item.cumulativeSummary.totalUnits,
          },
        });
      }
    });

    // Assemble sorted rows (by rank, then GPA, then name)
    const rows = preliminary
      .map((item) => {
        const rank = overallRankByStudent.get(item.student.studentId);
        const existingRc = reportCardByStudent.get(item.student.studentId);
        return {
          studentId: item.student.studentId,
          fullName: item.student.fullName,
          matricOrAdmissionNo: item.student.matricOrAdmissionNo,
          avatarUrl: item.student.avatarUrl,
          gradedCount: item.gradedCount,
          totalScore: item.totalScore,
          overallAverage: item.overallAverage,
          overallPosition: rank?.positionNumber ?? null,
          overallOrdinal: rank?.positionOrdinal ?? null,
          gpa: item.gradedCount > 0 ? item.termGpaSummary.gpa : 0,
          cgpa: item.cumulativeSummary.gpa,
          termUnits: item.termGpaSummary.totalUnits,
          cumulativeUnits: item.cumulativeSummary.totalUnits,
          totalQualityPoints: item.termGpaSummary.totalQualityPoints,
          standing: item.cumulativeSummary.standing,
          attendancePercent: item.attendancePercent,
          examEligible: item.examEligible,
          teacherRemark: existingRc?.teacherRemark ?? null,
          principalRemark: existingRc?.principalRemark ?? null,
          published: existingRc?.published ?? false,
          subjectScores: item.subjectScores,
        };
      })
      .sort((a, b) => {
        if (a.overallPosition !== null && b.overallPosition !== null) {
          return a.overallPosition - b.overallPosition;
        }
        if (a.overallPosition !== null) return -1;
        if (b.overallPosition !== null) return 1;
        return a.fullName.localeCompare(b.fullName);
      });

    const gradedRows = rows.filter((r) => r.gradedCount > 0);
    const classAverage =
      gradedRows.length > 0
        ? Math.round(
            (gradedRows.reduce((acc, r) => acc + r.overallAverage, 0) / gradedRows.length) *
              100,
          ) / 100
        : 0;
    const passedCount = gradedRows.filter((r) => r.overallAverage >= 40).length;
    const passRate =
      gradedRows.length > 0 ? Math.round((passedCount / gradedRows.length) * 100) : 0;

    return {
      school: {
        id: schoolClass.school.id,
        name: schoolClass.school.name,
        institutionType: schoolClass.school.institutionType,
        isTertiary,
      },
      schoolClass: {
        id: schoolClass.id,
        name: schoolClass.name,
        levelCode: schoolClass.levelCode,
        departmentName: schoolClass.department?.name ?? null,
      },
      term,
      terms,
      sessions,
      gpaScaleMax: config.gpaScaleMax,
      subjects: schoolClass.subjects.map((s) => ({
        id: s.id,
        name: s.name,
        courseCode: s.courseCode,
        creditUnits: s.creditUnits,
      })),
      stats: {
        totalStudents: rows.length,
        gradedStudents: gradedRows.length,
        classAverage,
        passRate,
        highestAverage:
          gradedRows.length > 0 ? Math.max(...gradedRows.map((r) => r.overallAverage)) : 0,
        highestGpa: gradedRows.length > 0 ? Math.max(...gradedRows.map((r) => r.gpa)) : 0,
        publishedCount: rows.filter((r) => r.published).length,
        allPublished: rows.length > 0 && rows.every((r) => r.published),
      },
      rows,
    };
  }

  /**
   * Draft Editable AI Teacher/Adviser & Principal/HOD Remarks for one student
   */
  async draftStudentReportCardRemarks(
    userId: string,
    classId: string,
    studentId: string,
    dto: {
      termId?: string;
      tone?: 'ENCOURAGING' | 'FORMAL' | 'CONSTRUCTIVE';
      saveImmediately?: boolean;
    },
  ) {
    const broadsheet = await this.computeClassBroadsheetAndPositions(
      classId,
      dto.termId,
      userId,
    );
    const row = broadsheet.rows.find((r) => r.studentId === studentId);
    if (!row) {
      throw new NotFoundException('Student not found in this class broadsheet.');
    }

    const scoredSubjects = broadsheet.subjects
      .map((s) => ({
        label: `${s.courseCode} (${s.name})`,
        score: row.subjectScores[s.id]?.totalScore,
      }))
      .filter((s): s is { label: string; score: number } => typeof s.score === 'number')
      .sort((a, b) => b.score - a.score);

    const strongestSubjects = scoredSubjects.slice(0, 2).map((s) => s.label);
    const weakestSubjects =
      scoredSubjects.length > 2
        ? scoredSubjects.slice(-2).map((s) => s.label)
        : [];

    const draft = await this.remarksAi.draftReportCardRemarks({
      studentName: row.fullName,
      overallPercentage: row.overallAverage,
      classPosition: row.overallOrdinal || 'Ranked',
      attendancePercentage: row.attendancePercent,
      strongestSubjects,
      weakestSubjects,
      isTertiary: broadsheet.school.isTertiary,
      gpa: row.gpa,
      cgpa: row.cgpa,
      gpaScaleMax: broadsheet.gpaScaleMax,
      standing: row.standing,
      tone: dto.tone,
    });

    if (dto.saveImmediately) {
      await this.prisma.terminalReportCard.updateMany({
        where: {
          classId,
          termId: broadsheet.term.id,
          studentId,
        },
        data: {
          teacherRemark: draft.teacherRemarkDraft,
          principalRemark: draft.principalRemarkDraft,
        },
      });
    }

    return {
      studentId,
      termId: broadsheet.term.id,
      ...draft,
    };
  }

  /**
   * Save manually edited Teacher / Principal remarks on a student's TerminalReportCard
   */
  async updateStudentReportCardRemarks(
    userId: string,
    classId: string,
    studentId: string,
    dto: {
      termId?: string;
      teacherRemark?: string | null;
      principalRemark?: string | null;
    },
  ) {
    const schoolClass = await this.verifyClassAccess(userId, classId);
    const { term } = await this.resolveTermForSchool(schoolClass.schoolId, dto.termId);

    const updateData: { teacherRemark?: string | null; principalRemark?: string | null } = {};
    if (dto.teacherRemark !== undefined) {
      updateData.teacherRemark = dto.teacherRemark?.trim() || null;
    }
    if (dto.principalRemark !== undefined) {
      updateData.principalRemark = dto.principalRemark?.trim() || null;
    }

    const card = await this.prisma.terminalReportCard.upsert({
      where: {
        termId_classId_studentId: {
          termId: term.id,
          classId,
          studentId,
        },
      },
      create: {
        schoolId: schoolClass.schoolId,
        termId: term.id,
        classId,
        studentId,
        ...updateData,
      },
      update: updateData,
    });

    return {
      message: 'Report card remarks saved.',
      termId: term.id,
      studentId,
      teacherRemark: card.teacherRemark,
      principalRemark: card.principalRemark,
    };
  }

  /**
   * Bulk AI-draft missing remarks across an entire class for fast end-of-term prep
   */
  async draftAllMissingClassRemarks(
    userId: string,
    classId: string,
    dto: { termId?: string; overwriteExisting?: boolean; tone?: 'ENCOURAGING' | 'FORMAL' | 'CONSTRUCTIVE' },
  ) {
    const broadsheet = await this.computeClassBroadsheetAndPositions(
      classId,
      dto.termId,
      userId,
    );

    const targets = broadsheet.rows.filter(
      (r) =>
        r.gradedCount > 0 &&
        (dto.overwriteExisting || !r.teacherRemark || !r.principalRemark),
    );

    let updatedCount = 0;
    for (const row of targets) {
      const scoredSubjects = broadsheet.subjects
        .map((s) => ({
          label: s.name || s.courseCode,
          score: row.subjectScores[s.id]?.totalScore,
        }))
        .filter((s): s is { label: string; score: number } => typeof s.score === 'number')
        .sort((a, b) => b.score - a.score);

      const draft = await this.remarksAi.draftReportCardRemarks({
        studentName: row.fullName,
        overallPercentage: row.overallAverage,
        classPosition: row.overallOrdinal || 'Ranked',
        attendancePercentage: row.attendancePercent,
        strongestSubjects: scoredSubjects.slice(0, 2).map((s) => s.label),
        weakestSubjects: scoredSubjects.length > 2 ? scoredSubjects.slice(-2).map((s) => s.label) : [],
        isTertiary: broadsheet.school.isTertiary,
        gpa: row.gpa,
        cgpa: row.cgpa,
        gpaScaleMax: broadsheet.gpaScaleMax,
        standing: row.standing,
        tone: dto.tone,
      });

      await this.prisma.terminalReportCard.updateMany({
        where: { classId, termId: broadsheet.term.id, studentId: row.studentId },
        data: {
          teacherRemark: dto.overwriteExisting
            ? draft.teacherRemarkDraft
            : row.teacherRemark || draft.teacherRemarkDraft,
          principalRemark: dto.overwriteExisting
            ? draft.principalRemarkDraft
            : row.principalRemark || draft.principalRemarkDraft,
        },
      });
      updatedCount += 1;
    }

    return {
      message: `Drafted AI remarks for ${updatedCount} student(s) in ${broadsheet.schoolClass.name}.`,
      updatedCount,
      termId: broadsheet.term.id,
    };
  }

  /**
   * Fetch single student's official report card / semester transcript data (for PDF generation)
   */
  async getStudentReportCardForClass(
    userId: string,
    classId: string,
    studentId: string,
    termId?: string,
  ) {
    const broadsheet = await this.computeClassBroadsheetAndPositions(
      classId,
      termId,
      userId,
    );
    const row = broadsheet.rows.find((r) => r.studentId === studentId);
    if (!row) {
      throw new NotFoundException('Student report card not found in this class.');
    }

    const [schoolMeta, studentUser, subjectGrades] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: broadsheet.school.id },
        select: {
          id: true,
          name: true,
          institutionType: true,
          logoUrl: true,
          primaryColor: true,
          address: true,
          contactEmail: true,
          contactPhone: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          fullName: true,
          email: true,
          studentProfile: {
            select: { matricOrAdmissionNo: true, level: true },
          },
        },
      }),
      this.prisma.studentSubjectGrade.findMany({
        where: {
          studentId,
          termId: broadsheet.term.id,
          classId,
        },
        include: {
          subject: {
            select: { id: true, name: true, courseCode: true, creditUnits: true },
          },
        },
        orderBy: { subject: { name: 'asc' } },
      }),
    ]);

    return {
      school: {
        ...broadsheet.school,
        logoUrl: schoolMeta?.logoUrl ?? null,
        primaryColor: schoolMeta?.primaryColor ?? '#4338CA',
        address: schoolMeta?.address ?? null,
        contactEmail: schoolMeta?.contactEmail ?? null,
        contactPhone: schoolMeta?.contactPhone ?? null,
      },
      schoolClass: {
        ...broadsheet.schoolClass,
        totalStudents: broadsheet.stats.totalStudents,
        classAverage: broadsheet.stats.classAverage,
      },
      term: broadsheet.term,
      gpaScaleMax: broadsheet.gpaScaleMax,
      student: {
        studentId,
        fullName: studentUser?.fullName || row.fullName,
        email: studentUser?.email || null,
        matricOrAdmissionNo:
          studentUser?.studentProfile?.matricOrAdmissionNo ||
          row.matricOrAdmissionNo,
        level: studentUser?.studentProfile?.level || broadsheet.schoolClass.levelCode || null,
      },
      summary: {
        totalScore: row.totalScore,
        overallAverage: row.overallAverage,
        overallPosition: row.overallPosition,
        overallOrdinal: row.overallOrdinal,
        gpa: row.gpa,
        cgpa: row.cgpa,
        termUnits: row.termUnits,
        cumulativeUnits: row.cumulativeUnits,
        totalQualityPoints: row.totalQualityPoints,
        standing: row.standing,
        attendancePercent: row.attendancePercent,
        examEligible: row.examEligible,
        teacherRemark: row.teacherRemark ?? null,
        principalRemark: row.principalRemark ?? null,
        published: row.published,
      },
      subjectGrades: subjectGrades.map((sg) => ({
        subjectId: sg.subjectId,
        name: sg.subject.name,
        courseCode: sg.subject.courseCode,
        creditUnits: sg.subject.creditUnits,
        scoresJson: sg.scoresJson,
        totalScore: sg.totalScore,
        letterGrade: sg.letterGrade,
        gradePoint: sg.gradePoint,
        subjectPosition: sg.subjectPosition,
        subjectOrdinal: sg.subjectOrdinal,
        teacherComment: sg.teacherComment,
      })),
    };
  }

  /**
   * Publish or Unpublish Class Results to Students (triggers Push + In-App + Email on publish)
   */
  async publishClassResults(
    userId: string,
    classId: string,
    dto: { termId?: string; published: boolean },
  ) {
    const broadsheet = await this.computeClassBroadsheetAndPositions(
      classId,
      dto.termId,
      userId,
    );

    await this.prisma.terminalReportCard.updateMany({
      where: {
        classId,
        termId: broadsheet.term.id,
      },
      data: {
        published: Boolean(dto.published),
      },
    });

    let notifiedCount = 0;
    if (dto.published && broadsheet.rows.length > 0) {
      const dispatchResults = await Promise.allSettled(
        broadsheet.rows.map((row) => {
          const metricText = broadsheet.school.isTertiary
            ? `Semester GPA: ${row.gpa.toFixed(2)}/${broadsheet.gpaScaleMax} (${row.standing})`
            : `Overall Average: ${row.overallAverage.toFixed(1)}%${
                row.overallOrdinal ? ` • Position: ${row.overallOrdinal}` : ''
              }`;

          return this.notifications.dispatchNotification({
            userId: row.studentId,
            schoolId: broadsheet.school.id,
            title: `${broadsheet.term.name} Results Published!`,
            body: `Your ${broadsheet.schoolClass.name} report card for ${broadsheet.term.sessionName} (${broadsheet.term.name}) is ready. ${metricText}. Open your Result Slip PDF in StudentSpark.`,
            category: 'SCHOOL',
            deepLink: '/results',
            dataJson: {
              termId: broadsheet.term.id,
              classId,
            },
            channels: {
              inApp: true,
              push: true,
              email: true,
            },
            emailSubject: `${broadsheet.school.name}: ${broadsheet.term.name} Results Published`,
            emailCtaLabel: 'View My Report Card',
          });
        }),
      );
      notifiedCount = dispatchResults.filter(
        (r) => r.status === 'fulfilled' && r.value !== null,
      ).length;
    }

    return {
      message: dto.published
        ? `Results published for ${broadsheet.schoolClass.name} (${broadsheet.term.name})${
            notifiedCount > 0 ? ` • ${notifiedCount} student(s) notified` : ''
          }.`
        : `Results unpublished for ${broadsheet.schoolClass.name}.`,
      published: Boolean(dto.published),
      termId: broadsheet.term.id,
      notifiedCount,
    };
  }

  /**
   * Student Academic Transcript / Terminal Results View
   */
  async getStudentGradesSummary(studentUserId: string, termId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: studentUserId },
      select: {
        id: true,
        fullName: true,
        email: true,
        schoolId: true,
        classId: true,
        studentProfile: {
          select: {
            classId: true,
            matricOrAdmissionNo: true,
            level: true,
            cgpa: true,
            totalCredits: true,
            department: { select: { name: true, code: true } },
            schoolClass: { select: { id: true, name: true, levelCode: true } },
          },
        },
      },
    });

    if (!user?.schoolId) {
      return {
        hasSchool: false,
        publishedCards: [],
        subjectGrades: [],
      };
    }

    const school = await this.prisma.school.findUnique({
      where: { id: user.schoolId },
      select: {
        id: true,
        name: true,
        institutionType: true,
        logoUrl: true,
        primaryColor: true,
        address: true,
        contactEmail: true,
        contactPhone: true,
      },
    });

    const isTertiary = this.isTertiaryInstitution(school?.institutionType);
    const config = await this.resolveAssessmentConfig(
      user.schoolId,
      undefined,
      school?.institutionType,
    );

    const { term, terms, sessions } = await this.resolveTermForSchool(user.schoolId, termId);
    const [reportCards, subjectGrades] = await Promise.all([
      this.prisma.terminalReportCard.findMany({
        where: {
          studentId: studentUserId,
          schoolId: user.schoolId,
          published: true,
        },
        include: {
          term: { include: { session: true } },
          schoolClass: { select: { id: true, name: true, levelCode: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.studentSubjectGrade.findMany({
        where: {
          studentId: studentUserId,
          termId: term.id,
        },
        include: {
          subject: {
            select: { id: true, name: true, courseCode: true, creditUnits: true },
          },
        },
        orderBy: { subject: { name: 'asc' } },
      }),
    ]);

    const currentPublishedCard = reportCards.find((rc) => rc.termId === term.id) ?? null;

    let classTotalStudents = 0;
    if (currentPublishedCard?.classId) {
      classTotalStudents = await this.prisma.terminalReportCard.count({
        where: {
          classId: currentPublishedCard.classId,
          termId: term.id,
        },
      });
    }

    const standing = currentPublishedCard?.cgpa
      ? this.gpaCalculator.classifyStanding(
          currentPublishedCard.cgpa,
          config.gpaScaleMax,
          school?.institutionType,
        )
      : this.gpaCalculator.classifyStanding(
          user.studentProfile?.cgpa ?? 0,
          config.gpaScaleMax,
          school?.institutionType,
        );

    return {
      hasSchool: true,
      school: {
        id: school?.id ?? user.schoolId,
        name: school?.name ?? 'Institution',
        institutionType: school?.institutionType ?? 'SECONDARY',
        isTertiary,
        logoUrl: school?.logoUrl ?? null,
        primaryColor: school?.primaryColor ?? '#4338CA',
        address: school?.address ?? null,
        contactEmail: school?.contactEmail ?? null,
        contactPhone: school?.contactPhone ?? null,
      },
      student: {
        id: user.id,
        fullName: user.fullName || 'Student',
        email: user.email,
        matricOrAdmissionNo: user.studentProfile?.matricOrAdmissionNo ?? null,
        level:
          user.studentProfile?.level ??
          currentPublishedCard?.schoolClass?.levelCode ??
          user.studentProfile?.schoolClass?.levelCode ??
          null,
        className:
          currentPublishedCard?.schoolClass?.name ??
          user.studentProfile?.schoolClass?.name ??
          'Assigned Class',
        departmentName: user.studentProfile?.department?.name ?? null,
      },
      term,
      terms,
      sessions,
      gpaScaleMax: config.gpaScaleMax,
      classTotalStudents,
      standing,
      profileSummary: {
        cgpa: user.studentProfile?.cgpa ?? 0,
        totalCredits: user.studentProfile?.totalCredits ?? 0,
        matricOrAdmissionNo: user.studentProfile?.matricOrAdmissionNo ?? null,
      },
      currentReportCard: currentPublishedCard,
      publishedCards: reportCards,
      // Only expose subject breakdown once class result for that term is published
      subjectGrades: currentPublishedCard ? subjectGrades : [],
    };
  }

  /**
   * SofaScore-style Session & Term Analytics (Overall Best, Class Champions, Subject Leaders,
   * Grade Distribution, Registered Student Counts, Attendance & Term Form Guide).
   */
  async getSessionTermAnalytics(
    userId: string,
    schoolId: string,
    query: { sessionId?: string; termId?: string },
  ) {
    const school = await this.verifySchoolAdminAccess(userId, schoolId);
    const isTertiary = this.isTertiaryInstitution(school.institutionType);
    const { activeTerm, sessions } = await this.ensureDefaultTerms(schoolId);

    let selectedTerm = query.termId
      ? sessions.flatMap((s) => s.terms).find((t) => t.id === query.termId)
      : undefined;

    if (query.termId && !selectedTerm) {
      throw new NotFoundException('Selected term does not belong to this institution.');
    }

    let selectedSession = selectedTerm
      ? sessions.find((s) => s.id === selectedTerm!.sessionId)
      : query.sessionId
      ? sessions.find((s) => s.id === query.sessionId)
      : sessions.find((s) => s.isCurrent) ?? sessions[0];

    if (!selectedSession) {
      throw new NotFoundException('Academic session not found for this institution.');
    }

    const scopeMode: 'TERM' | 'SESSION' = selectedTerm ? 'TERM' : 'SESSION';
    const targetTermIds = selectedTerm
      ? [selectedTerm.id]
      : selectedSession.terms.map((t) => t.id);
    const allSessionTermIds = selectedSession.terms.map((t) => t.id);

    const [
      classes,
      studentProfiles,
      subjectsCount,
      sessionGrades,
      reportCards,
      attendanceSessions,
      attendanceStatusCounts,
      quizzesCount,
      cbtSubmissionsCount,
    ] = await Promise.all([
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        select: {
          id: true,
          name: true,
          levelCode: true,
          _count: {
            select: { enrollments: true, studentProfiles: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.studentProfile.findMany({
        where: { schoolId },
        select: {
          userId: true,
          classId: true,
          level: true,
          matricOrAdmissionNo: true,
          user: {
            select: { fullName: true, avatarUrl: true },
          },
        },
      }),
      this.prisma.schoolSubject.count({ where: { schoolId } }),
      allSessionTermIds.length > 0
        ? this.prisma.studentSubjectGrade.findMany({
            where: {
              schoolId,
              termId: { in: allSessionTermIds },
            },
            include: {
              student: {
                select: {
                  id: true,
                  fullName: true,
                  avatarUrl: true,
                  studentProfile: {
                    select: { matricOrAdmissionNo: true, level: true },
                  },
                },
              },
              subject: {
                select: { id: true, name: true, courseCode: true, creditUnits: true },
              },
              schoolClass: {
                select: { id: true, name: true, levelCode: true },
              },
            },
          })
        : Promise.resolve([]),
      targetTermIds.length > 0
        ? this.prisma.terminalReportCard.findMany({
            where: {
              schoolId,
              termId: { in: targetTermIds },
            },
            select: {
              studentId: true,
              classId: true,
              overallAverage: true,
              gpa: true,
              attendancePercent: true,
              examEligible: true,
              published: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.attendanceSession.count({ where: { schoolId } }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { session: { schoolId } },
        _count: { _all: true },
      }),
      this.prisma.quiz.count({ where: { schoolId } }),
      this.prisma.cbtSubmission.count({ where: { quiz: { schoolId } } }),
    ]);

    const targetTermSet = new Set(targetTermIds);
    const scopedGrades = sessionGrades.filter((g) => targetTermSet.has(g.termId));

    // Student aggregates inside current scope
    interface StudentAgg {
      studentId: string;
      fullName: string;
      matricOrAdmissionNo: string;
      avatarUrl: string | null;
      classId: string;
      className: string;
      levelCode: string | null;
      totalSum: number;
      weightedGpaPoints: number;
      totalUnits: number;
      count: number;
      bestSubject: { courseCode: string; name: string; score: number } | null;
    }

    const studentMap = new Map<string, StudentAgg>();
    const classStudentMap = new Map<string, Map<string, StudentAgg>>();
    const subjectAggMap = new Map<
      string,
      {
        subjectId: string;
        name: string;
        courseCode: string;
        totalSum: number;
        count: number;
        passCount: number;
        highestScore: number;
        lowestScore: number;
        topStudentName: string;
      }
    >();

    const gradeBuckets: Record<string, number> = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
      E: 0,
      F: 0,
    };

    const classNameById = new Map(classes.map((c) => [c.id, c]));

    for (const g of scopedGrades) {
      const bandKey = (g.letterGrade || 'F').trim().charAt(0).toUpperCase();
      if (gradeBuckets[bandKey] !== undefined) {
        gradeBuckets[bandKey] += 1;
      }

      const units = Math.max(1, Number(g.subject?.creditUnits) || 1);
      const score = Number(g.totalScore) || 0;
      const gp = Number(g.gradePoint) || 0;

      // Global per-student agg
      const existing = studentMap.get(g.studentId);
      const matric = g.student?.studentProfile?.matricOrAdmissionNo || '—';
      const studentName = g.student?.fullName || 'Student';
      const clsName = g.schoolClass?.name || 'Class';
      const lvlCode =
        g.schoolClass?.levelCode || g.student?.studentProfile?.level || null;

      if (!existing) {
        studentMap.set(g.studentId, {
          studentId: g.studentId,
          fullName: studentName,
          matricOrAdmissionNo: matric,
          avatarUrl: g.student?.avatarUrl ?? null,
          classId: g.classId,
          className: clsName,
          levelCode: lvlCode,
          totalSum: score,
          weightedGpaPoints: gp * units,
          totalUnits: units,
          count: 1,
          bestSubject: {
            courseCode: g.subject?.courseCode || 'SUBJ',
            name: g.subject?.name || 'Subject',
            score,
          },
        });
      } else {
        existing.totalSum += score;
        existing.weightedGpaPoints += gp * units;
        existing.totalUnits += units;
        existing.count += 1;
        if (!existing.bestSubject || score > existing.bestSubject.score) {
          existing.bestSubject = {
            courseCode: g.subject?.courseCode || 'SUBJ',
            name: g.subject?.name || 'Subject',
            score,
          };
        }
      }

      // Per-class per-student agg
      if (!classStudentMap.has(g.classId)) {
        classStudentMap.set(g.classId, new Map());
      }
      const perCls = classStudentMap.get(g.classId)!;
      const clsExisting = perCls.get(g.studentId);
      if (!clsExisting) {
        perCls.set(g.studentId, {
          studentId: g.studentId,
          fullName: studentName,
          matricOrAdmissionNo: matric,
          avatarUrl: g.student?.avatarUrl ?? null,
          classId: g.classId,
          className: clsName,
          levelCode: lvlCode,
          totalSum: score,
          weightedGpaPoints: gp * units,
          totalUnits: units,
          count: 1,
          bestSubject: null,
        });
      } else {
        clsExisting.totalSum += score;
        clsExisting.weightedGpaPoints += gp * units;
        clsExisting.totalUnits += units;
        clsExisting.count += 1;
      }

      // Subject agg
      const subExisting = subjectAggMap.get(g.subjectId);
      if (!subExisting) {
        subjectAggMap.set(g.subjectId, {
          subjectId: g.subjectId,
          name: g.subject?.name || 'Subject',
          courseCode: g.subject?.courseCode || 'SUBJ',
          totalSum: score,
          count: 1,
          passCount: score >= 40 ? 1 : 0,
          highestScore: score,
          lowestScore: score,
          topStudentName: studentName,
        });
      } else {
        subExisting.totalSum += score;
        subExisting.count += 1;
        if (score >= 40) subExisting.passCount += 1;
        if (score > subExisting.highestScore) {
          subExisting.highestScore = score;
          subExisting.topStudentName = studentName;
        }
        if (score < subExisting.lowestScore) {
          subExisting.lowestScore = score;
        }
      }
    }

    const formatStudentRank = (agg: StudentAgg) => {
      const averageScore =
        agg.count > 0 ? Math.round((agg.totalSum / agg.count) * 100) / 100 : 0;
      const gpa =
        agg.totalUnits > 0
          ? Math.round((agg.weightedGpaPoints / agg.totalUnits) * 100) / 100
          : 0;
      const rating = Math.min(
        10,
        Math.max(1, Math.round((averageScore / 10) * 10) / 10),
      );
      return {
        studentId: agg.studentId,
        fullName: agg.fullName,
        matricOrAdmissionNo: agg.matricOrAdmissionNo,
        avatarUrl: agg.avatarUrl,
        classId: agg.classId,
        className: agg.className,
        levelCode: agg.levelCode,
        averageScore,
        gpa,
        rating,
        subjectsCount: agg.count,
        bestSubject: agg.bestSubject,
      };
    };

    const leaderboard = Array.from(studentMap.values())
      .map(formatStudentRank)
      .sort((a, b) => {
        if (isTertiary && Math.abs(b.gpa - a.gpa) > 0.001) {
          return b.gpa - a.gpa;
        }
        return b.averageScore - a.averageScore;
      });

    const overallBest = leaderboard[0] ?? null;

    // Top student + stats per class / level
    const classChampions = classes
      .map((cls) => {
        const stuMap = classStudentMap.get(cls.id);
        const studentsList = stuMap
          ? Array.from(stuMap.values())
              .map(formatStudentRank)
              .sort((a, b) =>
                isTertiary && Math.abs(b.gpa - a.gpa) > 0.001
                  ? b.gpa - a.gpa
                  : b.averageScore - a.averageScore,
              )
          : [];
        const gradedStudentsCount = studentsList.length;
        const classAverage =
          gradedStudentsCount > 0
            ? Math.round(
                (studentsList.reduce((acc, s) => acc + s.averageScore, 0) /
                  gradedStudentsCount) *
                  100,
              ) / 100
            : 0;
        const passed = studentsList.filter((s) => s.averageScore >= 40).length;
        const passRate =
          gradedStudentsCount > 0
            ? Math.round((passed / gradedStudentsCount) * 100)
            : 0;

        return {
          classId: cls.id,
          className: cls.name,
          levelCode: cls.levelCode,
          registeredCount: Math.max(
            cls._count.studentProfiles,
            cls._count.enrollments,
          ),
          gradedStudentsCount,
          classAverage,
          passRate,
          topStudent: studentsList[0] ?? null,
        };
      })
      .sort((a, b) => b.classAverage - a.classAverage || b.registeredCount - a.registeredCount);

    const bestPerformingClass =
      classChampions.find((c) => c.gradedStudentsCount > 0) ?? null;

    // Subject Insights
    const subjectStatsList = Array.from(subjectAggMap.values()).map((sub) => ({
      subjectId: sub.subjectId,
      name: sub.name,
      courseCode: sub.courseCode,
      entriesCount: sub.count,
      averageScore: Math.round((sub.totalSum / sub.count) * 100) / 100,
      passRate: Math.round((sub.passCount / sub.count) * 100),
      highestScore: Math.round(sub.highestScore * 100) / 100,
      lowestScore: Math.round(sub.lowestScore * 100) / 100,
      topStudentName: sub.topStudentName,
    }));

    const highestScoringSubjects = [...subjectStatsList]
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, 5);
    const toughestSubjects = [...subjectStatsList]
      .sort((a, b) => a.averageScore - b.averageScore)
      .slice(0, 3);

    // Grade Distribution Bars
    const totalGradeCount = scopedGrades.length;
    const gradeDistribution = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map(
      (grade) => {
        const count = gradeBuckets[grade] ?? 0;
        return {
          grade,
          count,
          percent:
            totalGradeCount > 0 ? Math.round((count / totalGradeCount) * 100) : 0,
        };
      },
    );

    // Term Form Trend across the selected Session
    const termFormTrend = selectedSession.terms.map((t) => {
      const termGrades = sessionGrades.filter((g) => g.termId === t.id);
      const distinctStudents = new Set(termGrades.map((g) => g.studentId)).size;
      const avg =
        termGrades.length > 0
          ? Math.round(
              (termGrades.reduce((sum, g) => sum + (Number(g.totalScore) || 0), 0) /
                termGrades.length) *
                100,
            ) / 100
          : 0;
      const passCount = termGrades.filter((g) => (Number(g.totalScore) || 0) >= 40).length;
      const topScore =
        termGrades.length > 0
          ? Math.max(...termGrades.map((g) => Number(g.totalScore) || 0))
          : 0;
      return {
        termId: t.id,
        termName: t.name,
        isCurrent: t.isCurrent,
        entriesCount: termGrades.length,
        gradedStudentsCount: distinctStudents,
        averageScore: avg,
        passRate:
          termGrades.length > 0
            ? Math.round((passCount / termGrades.length) * 100)
            : 0,
        topScore: Math.round(topScore * 100) / 100,
      };
    });

    // Overview KPIs
    const schoolAverage =
      leaderboard.length > 0
        ? Math.round(
            (leaderboard.reduce((sum, s) => sum + s.averageScore, 0) /
              leaderboard.length) *
              100,
          ) / 100
        : 0;
    const passedStudentsCount = leaderboard.filter((s) => s.averageScore >= 40).length;
    const schoolPassRate =
      leaderboard.length > 0
        ? Math.round((passedStudentsCount / leaderboard.length) * 100)
        : 0;

    let attTotal = 0;
    let attAttended = 0;
    for (const row of attendanceStatusCounts) {
      const cnt = row._count._all;
      attTotal += cnt;
      if (row.status !== 'ABSENT') attAttended += cnt;
    }
    const attendanceRate =
      attTotal > 0 ? Math.round((attAttended / attTotal) * 100) : null;

    return {
      school: {
        id: school.id,
        name: school.name,
        institutionType: school.institutionType,
        isTertiary,
      },
      scope: {
        mode: scopeMode,
        session: selectedSession,
        term: selectedTerm ?? null,
        activeTerm,
      },
      sessions,
      overview: {
        registeredStudents: studentProfiles.length,
        participatingStudents: leaderboard.length,
        classesCount: classes.length,
        gradedClassesCount: classChampions.filter((c) => c.gradedStudentsCount > 0).length,
        subjectsCount,
        evaluatedSubjectsCount: subjectStatsList.length,
        totalGradeEntries: scopedGrades.length,
        schoolAverage,
        schoolPassRate,
        distinctionCount: leaderboard.filter((s) => s.averageScore >= 70).length,
        atRiskCount: leaderboard.filter((s) => s.averageScore < 40).length,
        publishedCardsCount: reportCards.filter((rc) => rc.published).length,
        totalReportCardsCount: reportCards.length,
        attendanceRate,
        attendanceSessionsCount: attendanceSessions,
        cbtCount: quizzesCount,
        cbtSubmissionsCount,
      },
      overallBest,
      bestPerformingClass,
      topStudentsLeaderboard: leaderboard.slice(0, 5),
      classChampions,
      subjectInsights: {
        topScoringSubject: highestScoringSubjects[0] ?? null,
        hardestSubject: toughestSubjects[0] ?? null,
        highestScoringSubjects,
        toughestSubjects,
      },
      gradeDistribution,
      termFormTrend,
    };
  }
}
