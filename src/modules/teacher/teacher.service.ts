import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MarketplaceItemStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
import { OpenAiService } from '../ai/services/openai.service.js';
import { AssessmentsGradingService } from '../assessments-grading/assessments-grading.service.js';
import {
  getDefaultTraitsConfig,
  normalizeStudentTraitRatings,
} from '../assessments-grading/calculators/report-card-traits.helper.js';

@Injectable()
export class TeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storage: StorageService,
    private readonly openAiService: OpenAiService,
    private readonly gradingService: AssessmentsGradingService,
  ) {}

  /**
   * Helper: retrieve teacher profile or throw 403
   */
  private async findTeacherProfile(userId: string) {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { userId },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            schoolCode: true,
            institutionType: true,
            terminologyConfig: true,
            primaryColor: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        assignedClasses: {
          select: {
            id: true,
            name: true,
            levelCode: true,
          },
        },
        assignedSubjects: {
          select: {
            id: true,
            name: true,
            courseCode: true,
            creditUnits: true,
            classId: true,
          },
        },
      },
    });

    if (!profile) {
      throw new ForbiddenException(
        'Teacher profile not found. Ensure this account has been provisioned as a lecturer or teacher.',
      );
    }

    return profile;
  }

  /**
   * 1. GET /teacher/dashboard
   * Comprehensive stats and metadata for the lecturer dashboard
   */
  async getTeacherDashboard(userId: string) {
    const profile = await this.findTeacherProfile(userId);

    // Get assigned courses
    const assignedCourses = await this.getAssignedCourses(userId);
    const assignedClasses = await this.getAssignedClasses(userId);

    // Get enrolled student IDs across assigned classes
    const classIds = assignedClasses.map((c) => c.id);
    const studentsCount = await this.prisma.studentProfile.count({
      where: {
        schoolId: profile.schoolId,
        classId: { in: classIds.length > 0 ? classIds : ['none'] },
      },
    });

    // Count notes distributed by this teacher
    const notesCount = await this.prisma.note.count({
      where: {
        userId,
        isClassNote: true,
      },
    });

    // Count CBT quizzes published by this teacher
    const cbtCount = await this.prisma.quiz.count({
      where: {
        userId,
        isClassCbt: true,
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        loginId: true,
      },
    });

    const attendanceClasses = assignedClasses.filter((c) => c.canMarkAttendance);
    const formClasses = assignedClasses.filter((c) => c.isFormTeacher);

    return {
      teacherProfile: {
        ...profile,
        user,
      },
      stats: {
        coursesCount: assignedCourses.length,
        classesCount: assignedClasses.length,
        attendanceClassesCount: attendanceClasses.length,
        formClassesCount: formClasses.length,
        assignedClassNames: assignedClasses.map((c) => c.name),
        attendanceClassNames: attendanceClasses.map((c) => c.name),
        studentsCount,
        notesCount,
        cbtCount,
      },
      assignedCoursesSummary: assignedCourses.slice(0, 5),
    };
  }

  /**
   * 2. GET /teacher/profile
   */
  async getTeacherProfile(userId: string) {
    const profile = await this.findTeacherProfile(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        loginId: true,
        courses: true,
      },
    });

    return {
      ...profile,
      user,
    };
  }

  /**
   * 3. PATCH /teacher/profile
   * Update title, specialization, or full name
   */
  async updateTeacherProfile(
    userId: string,
    payload: {
      title?: string;
      specialization?: string;
      fullName?: string;
    },
  ) {
    const profile = await this.findTeacherProfile(userId);

    if (payload.fullName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { fullName: payload.fullName.trim() },
      });
    }

    const updatedProfile = await this.prisma.teacherProfile.update({
      where: { id: profile.id },
      data: {
        ...(payload.title !== undefined && { title: payload.title.trim() }),
        ...(payload.specialization !== undefined && {
          specialization: payload.specialization.trim(),
        }),
      },
      include: {
        school: true,
        department: true,
      },
    });

    return updatedProfile;
  }

  private isTertiaryInstitution(institutionType?: string | null): boolean {
    const t = String(institutionType || '').toUpperCase();
    return (
      t === 'UNIVERSITY' ||
      t === 'POLYTECHNIC' ||
      t === 'COLLEGE_OF_EDUCATION' ||
      t === 'TECHNICAL'
    );
  }

  /**
   * 4. GET /teacher/courses
   * Returns subjects/courses assigned to this teacher with student counts
   */
  async getAssignedCourses(userId: string) {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { userId },
      include: {
        assignedClasses: { select: { id: true } },
      },
    });

    const fullClassIds =
      profile?.handlesAllSubjects
        ? profile.assignedClasses.map((c) => c.id)
        : [];

    const subjects = await this.prisma.schoolSubject.findMany({
      where: {
        OR: [
          { teacherId: userId },
          ...(profile ? [{ assignedTeachers: { some: { id: profile.id } } }] : []),
          ...(fullClassIds.length > 0 ? [{ classId: { in: fullClassIds } }] : []),
        ],
      },
      include: {
        schoolClass: {
          select: {
            id: true,
            name: true,
            levelCode: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            notes: true,
            quizzes: true,
          },
        },
      },
      orderBy: [{ schoolClass: { name: 'asc' } }, { name: 'asc' }],
    });

    // Also get student counts per course class (cached per classId)
    const countMap = new Map<string, number>();
    const uniqueClassIds = Array.from(new Set(subjects.map((s) => s.classId)));
    await Promise.all(
      uniqueClassIds.map(async (cid) => {
        const cnt = await this.prisma.studentProfile.count({
          where: { classId: cid },
        });
        countMap.set(cid, cnt);
      }),
    );

    return subjects.map((subj) => ({
      id: subj.id,
      name: subj.name,
      courseCode: subj.courseCode,
      creditUnits: subj.creditUnits,
      minAttendancePercent: subj.minAttendancePercent,
      classId: subj.classId,
      className: subj.schoolClass.name,
      levelCode: subj.schoolClass.levelCode,
      departmentId: subj.departmentId,
      departmentName: subj.department?.name || 'General',
      departmentCode: subj.department?.code || '',
      notesCount: subj._count.notes,
      quizzesCount: subj._count.quizzes,
      enrolledStudentsCount: countMap.get(subj.classId) || 0,
    }));
  }

  /**
   * 5. GET /teacher/classes
   * Returns classes assigned to this teacher (as form teacher, full-class teacher, or subject instructor)
   */
  async getAssignedClasses(userId: string) {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { userId },
      include: {
        school: { select: { institutionType: true } },
        assignedClasses: { select: { id: true } },
      },
    });

    const assignedClassIdSet = new Set(
      (profile?.assignedClasses || []).map((c) => c.id),
    );
    const isTertiary = this.isTertiaryInstitution(profile?.school?.institutionType);

    const classes = await this.prisma.schoolClass.findMany({
      where: {
        OR: [
          { formTeacherId: userId },
          ...(profile ? [{ teacherProfiles: { some: { id: profile.id } } }] : []),
          {
            subjects: {
              some: {
                OR: [
                  { teacherId: userId },
                  ...(profile ? [{ assignedTeachers: { some: { id: profile.id } } }] : []),
                ],
              },
            },
          },
        ],
      },
      include: {
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        subjects: {
          select: {
            id: true,
            name: true,
            courseCode: true,
            teacherId: true,
            assignedTeachers: { select: { id: true } },
          },
          orderBy: { name: 'asc' },
        },
        _count: {
          select: {
            studentProfiles: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return classes.map((c) => {
      const isFormTeacher = c.formTeacherId === userId;
      const isFullClassTeacher = Boolean(
        profile?.handlesAllSubjects && assignedClassIdSet.has(c.id),
      );

      const effectiveSubjects = isFullClassTeacher
        ? c.subjects.map((s) => ({
            id: s.id,
            name: s.name,
            courseCode: s.courseCode,
          }))
        : c.subjects
            .filter(
              (s) =>
                s.teacherId === userId ||
                (profile && s.assignedTeachers.some((t) => t.id === profile.id)),
            )
            .map((s) => ({
              id: s.id,
              name: s.name,
              courseCode: s.courseCode,
            }));

      return {
        id: c.id,
        name: c.name,
        levelCode: c.levelCode,
        termOrSemester: c.termOrSemester,
        minAttendancePercent: c.minAttendancePercent ?? 75,
        departmentId: c.departmentId,
        departmentName: c.department?.name || 'General',
        isFormTeacher,
        handlesAllSubjects: isFullClassTeacher,
        canMarkAttendance: isTertiary ? true : isFormTeacher,
        studentCount: c._count.studentProfiles,
        totalClassSubjectsCount: c.subjects.length,
        assignedSubjects: effectiveSubjects,
      };
    });
  }

  /**
   * 6. GET /teacher/roster
   * Fetch enrolled students strictly scoped to teacher's courses and classes
   */
  async getEnrolledRoster(
    userId: string,
    filter: { subjectId?: string; classId?: string; search?: string },
  ) {
    const assignedClasses = await this.getAssignedClasses(userId);
    const assignedClassIds = assignedClasses.map((c) => c.id);

    if (assignedClassIds.length === 0) {
      return [];
    }

    let targetClassIds = assignedClassIds;

    if (filter.classId) {
      if (!assignedClassIds.includes(filter.classId)) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this class cohort.',
        );
      }
      targetClassIds = [filter.classId];
    } else if (filter.subjectId) {
      const subject = await this.prisma.schoolSubject.findUnique({
        where: { id: filter.subjectId },
      });
      if (!subject || !assignedClassIds.includes(subject.classId)) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this course subject.',
        );
      }
      targetClassIds = [subject.classId];
    }

    const whereClause: any = {
      classId: { in: targetClassIds },
    };

    if (filter.search && filter.search.trim().length > 0) {
      const q = filter.search.trim();
      whereClause.OR = [
        { matricOrAdmissionNo: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const students = await this.prisma.studentProfile.findMany({
      where: whereClause,
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
        schoolClass: {
          select: {
            id: true,
            name: true,
            levelCode: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: [
        { schoolClass: { name: 'asc' } },
        { user: { fullName: 'asc' } },
      ],
    });

    return students.map((s) => ({
      id: s.id,
      userId: s.userId,
      fullName: s.user.fullName || 'Student',
      email: s.user.email,
      avatarUrl: s.user.avatarUrl,
      matricOrAdmissionNo: s.matricOrAdmissionNo || s.user.loginId || 'N/A',
      studentCode: s.user.studentCode,
      classId: s.classId,
      className: s.schoolClass?.name || 'Class',
      levelCode: s.schoolClass?.levelCode || s.level || '100L',
      departmentName: s.department?.name || 'General',
      age: (s as any).age ?? null,
      guardianName: (s as any).guardianName ?? null,
      guardianRelationship: (s as any).guardianRelationship ?? null,
      guardianEmail: (s as any).guardianEmail ?? null,
      guardianPhone: (s as any).guardianPhone ?? null,
      cgpa: s.cgpa,
      totalCredits: s.totalCredits,
    }));
  }

  /**
   * 6b. GET /teacher/roster/:studentId/record
   * Comprehensive sectioned & tabbed academic record (Overview, Subjects, Attendance, Traits & Remarks)
   */
  async getStudentDetailedRecord(
    requesterUserId: string,
    studentProfileOrUserId: string,
    termId?: string,
  ) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { id: true, role: true, schoolId: true },
    });
    if (!requester) {
      throw new ForbiddenException('Account not found.');
    }

    const profile = await this.prisma.studentProfile.findFirst({
      where: {
        OR: [
          { id: studentProfileOrUserId },
          { userId: studentProfileOrUserId },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            studentCode: true,
            loginId: true,
            createdAt: true,
          },
        },
        school: {
          select: {
            id: true,
            name: true,
            schoolCode: true,
            institutionType: true,
            logoUrl: true,
            primaryColor: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true,
            unit: { select: { id: true, name: true, code: true } },
          },
        },
        schoolClass: {
          select: {
            id: true,
            name: true,
            levelCode: true,
            inviteCode: true,
            termOrSemester: true,
            formTeacherId: true,
            subjects: {
              include: {
                teacher: { select: { id: true, fullName: true } },
              },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Student academic profile not found.');
    }

    const isAdmin =
      requester.role === 'SCHOOL_ADMIN' || requester.role === 'SUPER_ADMIN';
    if (isAdmin) {
      if (
        requester.role === 'SCHOOL_ADMIN' &&
        requester.schoolId &&
        requester.schoolId !== profile.schoolId
      ) {
        throw new ForbiddenException(
          'Student belongs to a different institution.',
        );
      }
    } else {
      const teacher = await this.prisma.teacherProfile.findFirst({
        where: { userId: requesterUserId },
        select: { id: true, schoolId: true },
      });
      if (!teacher || teacher.schoolId !== profile.schoolId) {
        throw new ForbiddenException('Access denied for this student record.');
      }
      if (profile.classId) {
        const hasAccess = await this.prisma.schoolClass.findFirst({
          where: {
            id: profile.classId,
            OR: [
              { formTeacherId: requesterUserId },
              { teacherProfiles: { some: { id: teacher.id } } },
              {
                subjects: {
                  some: {
                    OR: [
                      { teacherId: requesterUserId },
                      { assignedTeachers: { some: { id: teacher.id } } },
                    ],
                  },
                },
              },
            ],
          },
          select: { id: true },
        });
        if (!hasAccess) {
          throw new ForbiddenException(
            'You are not assigned to this student’s class or subjects.',
          );
        }
      }
    }

    const instUpper = String(profile.school?.institutionType || '').toUpperCase();
    const isTertiary =
      instUpper.includes('UNIV') ||
      instUpper.includes('POLY') ||
      instUpper.includes('COLLEG') ||
      instUpper.includes('TERT');

    const [terms, sessions] = await Promise.all([
      this.prisma.academicTerm.findMany({
        where: { session: { schoolId: profile.schoolId } },
        orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          session: { select: { id: true, name: true, isCurrent: true } },
          sessionId: true,
          isCurrent: true,
          startDate: true,
          endDate: true,
        },
      }),
      this.prisma.academicSession.findMany({
        where: { schoolId: profile.schoolId },
        orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, name: true, isCurrent: true },
      }),
    ]);

    const selectedTerm =
      (termId ? terms.find((t) => t.id === termId) : null) ||
      terms.find((t) => t.isCurrent) ||
      terms[0] ||
      null;

    let reportCardData: any = null;
    if (profile.classId && selectedTerm) {
      try {
        reportCardData = await this.gradingService.getStudentReportCardForClass(
          requesterUserId,
          profile.classId,
          profile.userId,
          selectedTerm.id,
        );
      } catch {
        reportCardData = null;
      }
    }

    const schoolConfigRec = await this.prisma.assessmentConfig.findFirst({
      where: { schoolId: profile.schoolId, subjectId: null },
      select: {
        componentsJson: true,
        gradeScaleJson: true,
        traitsConfigJson: true,
        reportCardMetaJson: true,
        gpaScaleMax: true,
      },
    });

    const sessionFilter: any = {
      schoolId: profile.schoolId,
      ...(profile.classId ? { classId: profile.classId } : {}),
    };
    if (selectedTerm?.startDate && selectedTerm?.endDate) {
      sessionFilter.sessionDate = {
        gte: selectedTerm.startDate,
        lte: selectedTerm.endDate,
      };
    }

    const attendanceSessions = profile.classId
      ? await this.prisma.attendanceSession.findMany({
          where: sessionFilter,
          include: {
            subject: {
              select: {
                id: true,
                name: true,
                courseCode: true,
                minAttendancePercent: true,
              },
            },
            records: {
              where: { studentId: profile.userId },
              select: { status: true, checkedInAt: true },
            },
          },
          orderBy: { sessionDate: 'desc' },
          take: 100,
        })
      : [];

    let present = 0;
    let late = 0;
    let excused = 0;
    let absent = 0;
    const subjectAttendanceMap = new Map<
      string,
      { total: number; attended: number }
    >();

    const recentLogs = attendanceSessions.map((sess) => {
      const rec = sess.records[0];
      const status = rec?.status || 'ABSENT';
      if (status === 'PRESENT') present += 1;
      else if (status === 'LATE') late += 1;
      else if (status === 'EXCUSED') excused += 1;
      else absent += 1;

      if (sess.subjectId && sess.subject) {
        const cur = subjectAttendanceMap.get(sess.subjectId) || {
          total: 0,
          attended: 0,
        };
        cur.total += 1;
        if (status === 'PRESENT' || status === 'LATE' || status === 'EXCUSED') {
          cur.attended += 1;
        }
        subjectAttendanceMap.set(sess.subjectId, cur);
      }

      return {
        sessionId: sess.id,
        date: sess.sessionDate.toISOString(),
        subjectId: sess.subject?.id || sess.classId,
        subjectName: sess.subject?.name || 'Daily Class Register',
        courseCode: sess.subject?.courseCode || 'CLASS',
        status,
      };
    });

    const totalSessions = attendanceSessions.length;
    const attendedSessions = present + late + excused;
    const attendancePercent =
      totalSessions > 0
        ? Math.round((attendedSessions / totalSessions) * 100)
        : 100;

    const classSubjects = profile.schoolClass?.subjects || [];
    const gradedMap = new Map<string, any>(
      (reportCardData?.subjectGrades || []).map((sg: any) => [sg.subjectId, sg]),
    );

    const subjects = classSubjects.map((subj) => {
      const gradeRow = gradedMap.get(subj.id);
      const subjAtt = subjectAttendanceMap.get(subj.id);
      const subjAttPct =
        subjAtt && subjAtt.total > 0
          ? Math.round((subjAtt.attended / subjAtt.total) * 100)
          : null;
      return {
        subjectId: subj.id,
        name: subj.name,
        courseCode: subj.courseCode,
        creditUnits: subj.creditUnits,
        teacherName: subj.teacher?.fullName || null,
        minAttendancePercent: subj.minAttendancePercent,
        attendancePercent: subjAttPct,
        graded: Boolean(gradeRow),
        scoresJson: gradeRow?.scoresJson || null,
        totalScore: gradeRow?.totalScore ?? null,
        classAverage: gradeRow?.classAverage ?? null,
        letterGrade: gradeRow?.letterGrade ?? null,
        gradePoint: gradeRow?.gradePoint ?? null,
        subjectPosition: gradeRow?.subjectPosition ?? null,
        subjectOrdinal: gradeRow?.subjectOrdinal ?? null,
        teacherComment: gradeRow?.teacherComment ?? null,
      };
    });

    const reportCardRaw =
      profile.classId && selectedTerm
        ? await this.prisma.terminalReportCard.findUnique({
            where: {
              termId_classId_studentId: {
                termId: selectedTerm.id,
                classId: profile.classId,
                studentId: profile.userId,
              },
            },
            select: {
              traitRatingsJson: true,
              teacherRemark: true,
              principalRemark: true,
              published: true,
            },
          })
        : null;

    const defaultTraits = getDefaultTraitsConfig(profile.school?.institutionType);
    const traitsConfig =
      reportCardData?.assessmentConfig?.traitsConfig ||
      (schoolConfigRec?.traitsConfigJson as any) ||
      defaultTraits;
    const normalizedTraits = normalizeStudentTraitRatings(
      reportCardData?.traitRatings ?? reportCardRaw?.traitRatingsJson,
    );
    const totalTraitsCount = (traitsConfig.categories || []).reduce(
      (sum: number, cat: any) => sum + (cat.items?.length || 0),
      0,
    );
    const ratedTraitsCount = Object.keys(normalizedTraits.ratings || {}).length;

    const thresholdPercent = classSubjects[0]?.minAttendancePercent ?? 75;
    const examEligible = attendancePercent >= thresholdPercent;

    return {
      school: {
        id: profile.school.id,
        name: profile.school.name,
        schoolCode: profile.school.schoolCode,
        institutionType: profile.school.institutionType,
        isTertiary,
        gpaScaleMax:
          reportCardData?.gpaScaleMax ?? schoolConfigRec?.gpaScaleMax ?? 5.0,
        logoUrl: profile.school.logoUrl,
        primaryColor: profile.school.primaryColor,
      },
      student: {
        id: profile.id,
        userId: profile.userId,
        fullName: profile.user.fullName || 'Student',
        email: profile.user.email,
        avatarUrl: profile.user.avatarUrl,
        matricOrAdmissionNo:
          profile.matricOrAdmissionNo || profile.user.loginId || 'N/A',
        studentCode: profile.user.studentCode,
        loginId: profile.user.loginId,
        classId: profile.classId,
        className: profile.schoolClass?.name || 'Unassigned',
        levelCode: profile.schoolClass?.levelCode || profile.level || null,
        departmentId: profile.departmentId,
        departmentName: profile.department?.name || 'General',
        unitName: profile.department?.unit?.name || null,
        age: (profile as any).age ?? null,
        guardianName: (profile as any).guardianName ?? null,
        guardianRelationship: (profile as any).guardianRelationship ?? null,
        guardianEmail: (profile as any).guardianEmail ?? null,
        guardianPhone: (profile as any).guardianPhone ?? null,
        enrolledAt: profile.createdAt.toISOString(),
        userCreatedAt: profile.user.createdAt.toISOString(),
        cgpa: reportCardData?.summary?.cgpa ?? profile.cgpa,
        totalCredits:
          reportCardData?.summary?.cumulativeUnits ?? profile.totalCredits,
      },
      term: selectedTerm
        ? {
            id: selectedTerm.id,
            name: selectedTerm.name,
            session: selectedTerm.session?.name || '',
            sessionId: selectedTerm.sessionId,
            isCurrent: selectedTerm.isCurrent,
          }
        : null,
      terms: terms.map((t) => ({
        id: t.id,
        name: t.name,
        session: t.session?.name || '',
        sessionId: t.sessionId,
        isCurrent: t.isCurrent,
      })),
      sessions,
      assessmentConfig: reportCardData?.assessmentConfig || {
        components: schoolConfigRec?.componentsJson || [],
        gradeScale: schoolConfigRec?.gradeScaleJson || [],
        traitsConfig,
        reportCardMeta: schoolConfigRec?.reportCardMetaJson || null,
      },
      summary: {
        totalScore: reportCardData?.summary?.totalScore ?? 0,
        overallAverage: reportCardData?.summary?.overallAverage ?? 0,
        overallPosition: reportCardData?.summary?.overallPosition ?? null,
        overallOrdinal: reportCardData?.summary?.overallOrdinal ?? null,
        totalInClass: reportCardData?.schoolClass?.totalStudents ?? null,
        classAverage: reportCardData?.schoolClass?.classAverage ?? null,
        gpa: reportCardData?.summary?.gpa ?? 0,
        cgpa: reportCardData?.summary?.cgpa ?? profile.cgpa ?? 0,
        termUnits: reportCardData?.summary?.termUnits ?? 0,
        cumulativeUnits:
          reportCardData?.summary?.cumulativeUnits ?? profile.totalCredits ?? 0,
        standing: reportCardData?.summary?.standing ?? null,
        teacherRemark:
          reportCardData?.summary?.teacherRemark ??
          reportCardRaw?.teacherRemark ??
          null,
        principalRemark:
          reportCardData?.summary?.principalRemark ??
          reportCardRaw?.principalRemark ??
          null,
        published:
          reportCardData?.summary?.published ??
          reportCardRaw?.published ??
          false,
        gradedCount: subjects.filter((s) => s.graded).length,
        totalSubjectsCount: subjects.length,
      },
      subjects,
      attendance: {
        overallPercent: attendancePercent,
        examEligible,
        thresholdPercent,
        daysPresent: normalizedTraits.daysPresent ?? null,
        daysSchoolOpened:
          reportCardData?.assessmentConfig?.reportCardMeta?.daysSchoolOpened ??
          (schoolConfigRec?.reportCardMetaJson as any)?.daysSchoolOpened ??
          null,
        counts: {
          totalSessions,
          present,
          late,
          excused,
          absent,
        },
        recentLogs: recentLogs.slice(0, 15),
      },
      traits: {
        config: traitsConfig,
        ratings: normalizedTraits.ratings || {},
        daysPresent: normalizedTraits.daysPresent ?? null,
        ratedCount: ratedTraitsCount,
        totalTraitsCount,
      },
    };
  }

  /**
   * 7. GET /teacher/notes
   * List notes distributed by this teacher
   */
  async getTeacherNotes(userId: string, subjectId?: string) {
    const notes = await this.prisma.note.findMany({
      where: {
        userId,
        isClassNote: true,
        ...(subjectId ? { subjectId } : {}),
      },
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            courseCode: true,
          },
        },
        schoolClass: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return notes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      courseCode: n.courseCode,
      color: n.color,
      listsOfTopic: n.listsOfTopic,
      fileUrl: n.fileUrl,
      classId: n.classId,
      className: n.schoolClass?.name || 'Class',
      subjectId: n.subjectId,
      subjectName: n.subject?.name || 'Course',
      createdAt: n.createdAt.toISOString(),
    }));
  }

  /**
   * 8. POST /teacher/notes
   * Distribute course note / lecture handout (and optional file) to assigned class
   */
  async createTeacherNote(
    userId: string,
    payload: {
      title: string;
      summary?: string;
      courseCode: string;
      subjectId: string;
      classId: string;
      listsOfTopic?: string[];
      color?: string;
      fileUrl?: string;
      fileBase64?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      alsoPostToClassHandouts?: boolean;
    },
  ) {
    const hasFile = Boolean(payload.fileBase64 || payload.fileUrl);
    if (!payload.title?.trim() || (!payload.summary?.trim() && !hasFile) || !payload.subjectId || !payload.classId) {
      throw new BadRequestException(
        'Missing required fields: title, subjectId, classId, and either lecture summary or an attached file are required.',
      );
    }

    const profile = await this.findTeacherProfile(userId);

    // Verify course belongs to this teacher or school
    const subject = await this.prisma.schoolSubject.findUnique({
      where: { id: payload.subjectId },
      include: {
        schoolClass: {
          select: {
            levelCode: true,
            termOrSemester: true,
          },
        },
      },
    });
    if (!subject) {
      throw new NotFoundException('Course subject not found.');
    }

    let resolvedFileUrl: string | null = payload.fileUrl || null;
    if (payload.fileBase64) {
      try {
        const cleanBase64 = payload.fileBase64.includes('base64,')
          ? payload.fileBase64.split('base64,')[1]
          : payload.fileBase64;
        const fileBuffer = Buffer.from(cleanBase64, 'base64');
        if (!fileBuffer.byteLength) {
          throw new BadRequestException('Uploaded file appears empty.');
        }
        const safeOriginal = (payload.fileName || payload.title || 'handout.pdf').replace(
          /[^a-zA-Z0-9._-]/g,
          '_',
        );
        const storageName = `${randomUUID().slice(0, 8)}_${safeOriginal}`;
        const uploaded = await this.storage.uploadPdfBuffer(fileBuffer, storageName, 'notes');
        resolvedFileUrl = uploaded.publicUrl;
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException(
          `Could not upload handout file to cloud storage: ${err?.message || 'Upload error'}`,
        );
      }
    }

    const resolvedSummary =
      payload.summary?.trim() ||
      `Attached File: ${payload.fileName || payload.title.trim()}`;

    const lowerFile = `${payload.fileName || ''} ${resolvedFileUrl || ''} ${payload.mimeType || ''}`.toLowerCase();
    const resolvedFormat = lowerFile.includes('pdf')
      ? 'PDF'
      : lowerFile.includes('image') || lowerFile.includes('.jpg') || lowerFile.includes('.png')
      ? 'IMAGE'
      : lowerFile.includes('.doc') || lowerFile.includes('.ppt')
      ? 'DOC'
      : 'HANDOUT';

    const note = await this.prisma.note.create({
      data: {
        userId,
        schoolId: profile.schoolId,
        classId: payload.classId,
        subjectId: payload.subjectId,
        title: payload.title.trim(),
        summary: resolvedSummary,
        courseCode: payload.courseCode || subject.courseCode,
        color: payload.color || '#EA580C',
        listsOfTopic: payload.listsOfTopic || [],
        fileUrl: resolvedFileUrl,
        isClassNote: true,
      },
      include: {
        subject: true,
        schoolClass: true,
      },
    });

    const teacherUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    // Always mirror created class notes to E-Library Class Handouts shelf
    let mirroredToClassHandouts = false;
    let mirroredBookId: string | null = null;
    try {
      const mirroredItem = await this.prisma.marketplaceItem.create({
        data: {
          sellerId: userId,
          schoolId: profile.schoolId,
          classId: payload.classId,
          subjectId: payload.subjectId,
          title: payload.title.trim(),
          description: resolvedSummary,
          authorName:
            profile.title && teacherUser?.fullName && !teacherUser.fullName.toLowerCase().startsWith(profile.title.toLowerCase())
              ? `${profile.title} ${teacherUser.fullName}`
              : teacherUser?.fullName || 'Course Lecturer',
          courseCode: payload.courseCode || subject.courseCode,
          institutionType: profile.school?.institutionType || 'SECONDARY',
          priceKobo: 0,
          isFree: true,
          encryptedFileUrl: resolvedFileUrl || `class-note://${note.id}`,
          status: MarketplaceItemStatus.APPROVED,
          visibilityScope: 'COURSE_OR_CLASS',
          format: resolvedFormat,
          fileSize: payload.fileSize || null,
          pageCount: 1,
          departmentName: profile.department?.name || null,
          levelName: subject.schoolClass?.levelCode || null,
          termOrSemester: subject.schoolClass?.termOrSemester || null,
        },
      });
      mirroredToClassHandouts = true;
      mirroredBookId = mirroredItem.id;
    } catch (err) {
      console.warn('Could not mirror note to marketplace item:', err);
    }

    // Notify students of this class
    const enrolledStudents = await this.prisma.studentProfile.findMany({
      where: { classId: payload.classId },
      select: { userId: true },
    });

    for (const student of enrolledStudents) {
      this.notificationsService
        .dispatchNotification({
          userId: student.userId,
          schoolId: profile.schoolId,
          title: `📚 New Class Note: ${note.title}`,
          body: `${teacherUser?.fullName || 'Your lecturer'} shared a new handout for ${note.courseCode}.`,
          category: 'SCHOOL',
          deepLink: mirroredBookId
            ? `/ebookReader?bookId=${mirroredBookId}`
            : `/notesDetails?id=${note.id}`,
        })
        .catch(() => {});
    }

    return {
      ...note,
      mirroredToClassHandouts,
    };
  }

  /**
   * 8b. POST /teacher/notes/generate
   * Generate an editable full lesson note (or optional summary if requested) for blackboard copying / printing
   */
  async generateTeacherNoteDraft(
    userId: string,
    payload: {
      subjectId: string;
      topic: string;
      mode?: 'FULL_NOTE' | 'SUMMARIZE';
      sourceTextOrHints?: string;
    },
  ) {
    if (!payload.subjectId || !payload.topic?.trim()) {
      throw new BadRequestException('Please select a target course/subject and enter a lesson topic.');
    }

    const profile = await this.findTeacherProfile(userId);
    const subject = await this.prisma.schoolSubject.findUnique({
      where: { id: payload.subjectId },
      include: {
        schoolClass: {
          select: {
            name: true,
            levelCode: true,
            termOrSemester: true,
          },
        },
        department: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!subject) {
      throw new NotFoundException('Assigned course/subject not found.');
    }

    const topicClean = payload.topic.trim();
    const className = subject.schoolClass?.name || subject.schoolClass?.levelCode || 'Class';
    const instType = profile.school?.institutionType || 'SECONDARY';
    const isSummarizeMode = payload.mode === 'SUMMARIZE';

    // Try OpenAI if a real API key is configured
    const hasRealKey =
      Boolean(process.env.OPENAI_API_KEY) &&
      process.env.OPENAI_API_KEY !== 'missing-openai-key' &&
      !process.env.OPENAI_API_KEY?.includes('your_');

    if (hasRealKey) {
      try {
        const systemPrompt = isSummarizeMode
          ? `You are an expert ${instType.toLowerCase()} educator preparing a concise study revision note for ${subject.courseCode} (${subject.name}) — ${className}.
Return ONLY valid JSON with keys:
{
  "title": "Lesson Title",
  "topics": ["Subtopic 1", "Subtopic 2", "Subtopic 3"],
  "content": "Well-structured plain text / markdown note ready for editing and printing"
}`
          : `You are an experienced Nigerian ${instType.toLowerCase()} educator writing a COMPLETE, comprehensive, blackboard-ready classroom lesson note for ${subject.courseCode} (${subject.name}) — ${className}.
Do NOT summarize or shorten unnecessarily: write the full lesson note that students can copy from the board or read in full, including:
1. Topic & Learning Objectives
2. Introduction / Meaning & Definitions
3. Detailed Step-by-Step Explanation of Sub-topics
4. Worked Examples / Real-World Illustrations
5. Classwork / Evaluation Questions & Assignment
Return ONLY valid JSON with keys:
{
  "title": "Full Lesson Title",
  "topics": ["Subtopic 1", "Subtopic 2", "Subtopic 3"],
  "content": "Complete blackboard-ready lesson note text..."
}`;

        const userPrompt = payload.sourceTextOrHints?.trim()
          ? `Topic: ${topicClean}\nCourse: ${subject.courseCode} - ${subject.name} (${className})\nTeacher Notes / Source Text to use:\n${payload.sourceTextOrHints.trim()}`
          : `Topic: ${topicClean}\nCourse: ${subject.courseCode} - ${subject.name} (${className})\nGenerate the complete classroom note now.`;

        const raw = await this.openAiService.chatCompletion({
          systemPrompt,
          userPrompt,
          temperature: 0.4,
        });

        const parsed = this.openAiService.cleanJsonOutput<{
          title: string;
          topics: string[];
          content: string;
        }>(raw, {
          title: '',
          topics: [],
          content: '',
        });

        if (parsed.content && parsed.content.trim().length > 40) {
          return {
            title: parsed.title || topicClean,
            topics:
              Array.isArray(parsed.topics) && parsed.topics.length > 0
                ? parsed.topics
                : [topicClean, subject.courseCode],
            content: parsed.content.trim(),
            courseCode: subject.courseCode,
            className,
          };
        }
      } catch (err) {
        console.warn('OpenAI note draft fallback triggered:', (err as Error).message);
      }
    }

    // Structured curriculum fallback generator (works 100% offline/without OpenAI key)
    const extraHints = payload.sourceTextOrHints?.trim();
    const generatedTitle = `${subject.courseCode}: ${topicClean}`;
    const generatedTopics = [
      topicClean,
      `Principles of ${topicClean}`,
      `Applications & Examples`,
    ];

    const fullBoardNote = isSummarizeMode
      ? [
          `SUBJECT: ${subject.name} (${subject.courseCode})`,
          `CLASS: ${className}`,
          `TOPIC: ${topicClean.toUpperCase()} (SUMMARY REVISION)`,
          ``,
          `1. KEY DEFINITIONS & CORE CONCEPT`,
          `• ${topicClean} is a foundational topic in ${subject.name} that explains the principles, structure, and practical relationships governing this area of study.`,
          extraHints ? `\n• Key Highlights:\n${extraHints}` : '',
          ``,
          `2. ESSENTIAL POINTS TO REMEMBER`,
          `• Always state fundamental definitions clearly before applying formulas or principles.`,
          `• Identify the governing conditions, classifications, and standard units.`,
          `• Compare theoretical expectations with practical real-world observations.`,
          ``,
          `3. QUICK REVISION QUESTIONS`,
          `1) Define ${topicClean} in your own words.`,
          `2) State three major characteristics or laws associated with ${topicClean}.`,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `==================================================`,
          `SUBJECT: ${subject.name.toUpperCase()} (${subject.courseCode})`,
          `CLASS / LEVEL: ${className}`,
          `TOPIC: ${topicClean.toUpperCase()}`,
          `==================================================`,
          ``,
          `BEHAVIORAL OBJECTIVES:`,
          `By the end of this lesson, students should be able to:`,
          `1. Define and explain the meaning of ${topicClean}.`,
          `2. Identify the main types, components, or principles of ${topicClean}.`,
          `3. Solve practical problems and give real-life examples of ${topicClean}.`,
          ``,
          `--------------------------------------------------`,
          `1. INTRODUCTION & MEANING`,
          `--------------------------------------------------`,
          `${topicClean} is an essential concept in ${subject.name}. It deals with the systematic study of how components interact, operate, and produce measurable outcomes within the curriculum scope of ${className}.`,
          extraHints
            ? `\nTEACHER SOURCE NOTES / REFERENCE:\n${extraHints}\n`
            : '',
          `--------------------------------------------------`,
          `2. CORE PRINCIPLES & DETAILED EXPLANATION`,
          `--------------------------------------------------`,
          `A. Fundamental Characteristics:`,
          `   i.   It follows well-defined rules, stages, and observable properties.`,
          `   ii.  Every stage of ${topicClean} can be analyzed using standard definitions and examples.`,
          `   iii. Understanding the relationship between cause and effect is necessary for mastery.`,
          ``,
          `B. Step-by-Step Breakdown (Board Copy):`,
          `   • Step 1: Identify the given parameters, terms, or biological/physical structures.`,
          `   • Step 2: Apply the appropriate rule, law, or classification method for ${topicClean}.`,
          `   • Step 3: Verify the result and state the conclusion clearly with appropriate units/terms.`,
          ``,
          `--------------------------------------------------`,
          `3. WORKED EXAMPLES & ILLUSTRATIONS`,
          `--------------------------------------------------`,
          `Example 1:`,
          `Question: Explain how ${topicClean} applies in a standard ${subject.name} scenario.`,
          `Solution / Guide:`,
          `- First, state the definition of ${topicClean}.`,
          `- Next, list the key factors involved and show how each factor contributes to the final outcome.`,
          ``,
          `--------------------------------------------------`,
          `4. CLASSWORK / EVALUATION (COPY INSIDE NOTEBOOK)`,
          `--------------------------------------------------`,
          `1. What is meant by ${topicClean}?`,
          `2. List and explain three (3) important features or stages of ${topicClean}.`,
          `3. State two (2) practical applications of ${topicClean} in everyday life.`,
          ``,
          `ASSIGNMENT:`,
          `Read up on the next sub-topic in your ${subject.name} textbook and answer the revision exercises in your workbook.`,
        ]
          .filter((line) => line !== undefined)
          .join('\n');

    return {
      title: generatedTitle,
      topics: generatedTopics,
      content: fullBoardNote,
      courseCode: subject.courseCode,
      className,
    };
  }

  /**
   * 8c. PATCH /teacher/notes/:id
   * Edit an existing class note (title, full content, topics) and update Class Handouts mirror
   */
  async updateTeacherNote(
    userId: string,
    noteId: string,
    payload: {
      title?: string;
      summary?: string;
      listsOfTopic?: string[];
      alsoPostToClassHandouts?: boolean;
    },
  ) {
    const existing = await this.prisma.note.findUnique({
      where: { id: noteId },
    });
    if (!existing) {
      throw new NotFoundException('Course note not found.');
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException('You can only edit notes you created.');
    }

    const updatedTitle = payload.title?.trim() || existing.title;
    const updatedSummary = payload.summary?.trim() || existing.summary;
    const updatedTopics =
      payload.listsOfTopic !== undefined ? payload.listsOfTopic : (existing.listsOfTopic as any);

    const updatedNote = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        title: updatedTitle,
        summary: updatedSummary,
        listsOfTopic: updatedTopics,
      },
      include: {
        subject: true,
        schoolClass: true,
      },
    });

    // Update any mirrored item in E-Library Class Handouts
    await this.prisma.marketplaceItem
      .updateMany({
        where: {
          sellerId: userId,
          visibilityScope: 'COURSE_OR_CLASS',
          OR: [
            { encryptedFileUrl: `class-note://${noteId}` },
            {
              classId: existing.classId,
              subjectId: existing.subjectId,
              title: existing.title,
            },
          ],
        },
        data: {
          title: updatedTitle,
          description: updatedSummary,
        },
      })
      .catch(() => {});

    return updatedNote;
  }

  /**
   * 9. DELETE /teacher/notes/:id
   */
  async deleteTeacherNote(userId: string, noteId: string) {
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    if (note.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this note.');
    }

    await this.prisma.note.delete({
      where: { id: noteId },
    });

    // Clean up any mirrored Class Handouts entry
    await this.prisma.marketplaceItem
      .deleteMany({
        where: {
          sellerId: userId,
          visibilityScope: 'COURSE_OR_CLASS',
          classId: note.classId,
          subjectId: note.subjectId,
          title: note.title,
        },
      })
      .catch(() => {});

    return { success: true, message: 'Class note removed successfully.' };
  }

  /**
   * 10. GET /teacher/cbt
   * List CBT assessments published by this teacher
   */
  async getTeacherCBTs(userId: string, subjectId?: string) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        userId,
        isClassCbt: true,
        ...(subjectId ? { subjectId } : {}),
      },
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            courseCode: true,
          },
        },
        schoolClass: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            cbtSubmissions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return quizzes.map((q) => {
      const qData = q.questions as any;
      const questionsList = Array.isArray(qData)
        ? qData
        : qData?.questions || [];

      return {
        id: q.id,
        title: q.title,
        courseCode: q.courseCode,
        color: q.color,
        timeLimit: q.timeLimit,
        timeLimitMinutes: Math.round(q.timeLimit / 60),
        totalPossibleMarks: q.totalPossibleMarks,
        dueDate: q.dueDate ? q.dueDate.toISOString() : null,
        classId: q.classId,
        className: q.schoolClass?.name || 'Class',
        subjectId: q.subjectId,
        subjectName: q.subject?.name || 'Course',
        questionCount: questionsList.length,
        submissionsCount: q._count.cbtSubmissions,
        createdAt: q.createdAt.toISOString(),
      };
    });
  }

  private async extractTextFromUploadedNote(payload: {
    fileBase64?: string;
    fileName?: string;
    mimeType?: string;
  }): Promise<string> {
    if (!payload.fileBase64) return '';
    const cleanBase64 = payload.fileBase64.includes('base64,')
      ? payload.fileBase64.split('base64,')[1]
      : payload.fileBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (!buffer || buffer.length === 0) return '';

    const lowerName = (payload.fileName || '').toLowerCase();
    const lowerMime = (payload.mimeType || '').toLowerCase();

    if (
      lowerName.endsWith('.pdf') ||
      lowerMime.includes('pdf') ||
      buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    ) {
      try {
        const pdfExtractModule: any = await import('pdf-extraction');
        const pdfExtract = pdfExtractModule.default || pdfExtractModule;
        const pdfData = await pdfExtract(buffer);
        return String(pdfData?.text || '').trim();
      } catch (err: any) {
        throw new BadRequestException(
          `Could not extract text from PDF note: ${err?.message || 'Invalid PDF'}`,
        );
      }
    }

    if (
      lowerName.endsWith('.docx') ||
      lowerMime.includes('wordprocessingml')
    ) {
      try {
        const admZipMod: any = await import('adm-zip');
        const AdmZipCtor = admZipMod.default || admZipMod;
        const zip = new AdmZipCtor(buffer);
        const xmlEntry = zip.getEntry('word/document.xml');
        if (xmlEntry) {
          const xmlText = xmlEntry.getData().toString('utf8');
          return xmlText
            .replace(/<\/w:p>/g, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
      } catch (err: any) {
        throw new BadRequestException(
          `Could not extract text from DOCX file: ${err?.message || 'Invalid DOCX'}`,
        );
      }
    }

    return buffer.toString('utf8').replace(/\u0000/g, '').trim();
  }

  /**
   * 10b. POST /teacher/cbt/generate-questions
   * Extract questions with options + correct answers + explanations from teacher notes or uploaded files
   */
  async generateCbtQuestionsFromNote(
    userId: string,
    payload: {
      subjectId: string;
      noteId?: string;
      noteText?: string;
      fileBase64?: string;
      fileName?: string;
      mimeType?: string;
      questionCount?: number;
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED';
      includeExplanations?: boolean;
    },
  ) {
    if (!payload.subjectId) {
      throw new BadRequestException('Please select a target course first.');
    }

    const profile = await this.findTeacherProfile(userId);
    const subject = await this.prisma.schoolSubject.findUnique({
      where: { id: payload.subjectId },
      include: {
        schoolClass: { select: { name: true, levelCode: true } },
      },
    });
    if (!subject) {
      throw new NotFoundException('Target course/subject not found.');
    }

    const segments: string[] = [];
    let resolvedSourceTitle = '';

    if (payload.noteId) {
      const existingNote = await this.prisma.note.findUnique({
        where: { id: payload.noteId },
      });
      if (existingNote) {
        resolvedSourceTitle = existingNote.title || '';
        const topics = Array.isArray(existingNote.listsOfTopic)
          ? (existingNote.listsOfTopic as string[]).join(', ')
          : '';
        segments.push(
          `Note Title: ${existingNote.title}\nTopics: ${topics}\nContent:\n${existingNote.summary || ''}`,
        );
      }
    }

    if (payload.fileBase64) {
      const extractedFileText = await this.extractTextFromUploadedNote(payload);
      if (extractedFileText) {
        if (!resolvedSourceTitle && payload.fileName) {
          resolvedSourceTitle = payload.fileName
            .replace(/\.[^/.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .trim();
        }
        segments.push(`Uploaded File (${payload.fileName || 'note'}):\n${extractedFileText}`);
      }
    }

    if (payload.noteText?.trim()) {
      segments.push(payload.noteText.trim());
    }

    const combinedSource = segments.join('\n\n').trim();
    if (combinedSource.length < 20) {
      throw new BadRequestException(
        'Please upload a readable note file (PDF, DOCX, TXT), select an existing class note, or paste enough study notes/topics for AI question extraction.',
      );
    }

    const questionCount = Math.max(
      1,
      Math.min(50, Math.round(Number(payload.questionCount) || 10)),
    );
    const difficulty = payload.difficulty || 'MEDIUM';
    const includeExplanations = payload.includeExplanations !== false;
    const className =
      subject.schoolClass?.name || subject.schoolClass?.levelCode || 'Class';
    const instType = profile.school?.institutionType || 'SECONDARY';
    const clippedText = combinedSource.slice(0, 14000);

    const hasRealKey =
      Boolean(process.env.OPENAI_API_KEY) &&
      process.env.OPENAI_API_KEY !== 'missing-openai-key' &&
      !process.env.OPENAI_API_KEY?.includes('your_');

    let aiQuestions: Array<{
      question: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: 'A' | 'B' | 'C' | 'D';
      explanation: string;
    }> = [];
    let suggestedTitle =
      resolvedSourceTitle
        ? `${subject.courseCode}: ${resolvedSourceTitle} CBT`
        : `${subject.courseCode} Assessment`;

    if (hasRealKey) {
      try {
        const difficultyGuidance =
          difficulty === 'EASY'
            ? 'focus on foundational definitions, recall, and straightforward comprehension.'
            : difficulty === 'HARD'
            ? 'focus on application, analysis, problem-solving, and subtle conceptual distinctions.'
            : difficulty === 'MIXED'
            ? 'include a balanced mix of Easy recall, Medium understanding, and Hard analytical questions.'
            : 'focus on clear conceptual understanding and standard exam-level application.';

        const systemPrompt = `You are an expert ${instType.toLowerCase()} examiner preparing a ${questionCount}-question multiple-choice CBT assessment for ${subject.courseCode} (${subject.name}) — ${className}.
Carefully extract/generate EXACTLY ${questionCount} distinct multiple-choice questions strictly grounded in the teacher's uploaded/provided study note.
Difficulty level: ${difficulty} — ${difficultyGuidance}
Each question MUST have 4 plausible options (A, B, C, D) and a clear single correct letter ("A", "B", "C", or "D").
Return ONLY valid JSON:
{
  "suggestedTitle": "Concise Assessment Title",
  "questions": [
    {
      "question": "Clear question text",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "correctAnswer": "A",
      "explanation": "${includeExplanations ? 'Short explanation referencing the note' : ''}"
    }
  ]
}`;

        const raw = await this.openAiService.chatCompletion({
          systemPrompt,
          userPrompt: `Teacher Note / Study Material:\n\n${clippedText}\n\nGenerate ${questionCount} ${difficulty} questions now.`,
          temperature: 0.35,
        });

        const parsed = this.openAiService.cleanJsonOutput<{
          suggestedTitle?: string;
          questions?: Array<{
            question?: string;
            options?: string[];
            correctAnswer?: string | number;
            explanation?: string;
          }>;
        }>(raw, { questions: [] });

        if (parsed.suggestedTitle?.trim()) {
          suggestedTitle = parsed.suggestedTitle.trim();
        }

        const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
        if (Array.isArray(parsed.questions)) {
          aiQuestions = parsed.questions
            .filter((q) => q?.question && Array.isArray(q.options) && q.options.length >= 2)
            .slice(0, questionCount)
            .map((q) => {
              const opts = q.options || [];
              let ans: 'A' | 'B' | 'C' | 'D' = 'A';
              const rawAns = String(q.correctAnswer ?? 'A').trim().toUpperCase();
              if (rawAns === 'A' || rawAns === 'B' || rawAns === 'C' || rawAns === 'D') {
                ans = rawAns;
              } else if (/^[0-3]$/.test(rawAns)) {
                ans = letters[Number(rawAns)] || 'A';
              } else {
                const matchIdx = opts.findIndex(
                  (o) => o.trim().toLowerCase() === rawAns.toLowerCase(),
                );
                if (matchIdx >= 0 && matchIdx < 4) {
                  ans = letters[matchIdx];
                }
              }
              return {
                question: String(q.question).trim(),
                optionA: String(opts[0] || 'Option A').trim(),
                optionB: String(opts[1] || 'Option B').trim(),
                optionC: String(opts[2] || 'Option C').trim(),
                optionD: String(opts[3] || 'Option D').trim(),
                correctAnswer: ans,
                explanation: includeExplanations
                  ? String(q.explanation || '').trim()
                  : '',
              };
            });
        }
      } catch {
        // Fallback below if OpenAI call fails or key is absent
      }
    }

    if (aiQuestions.length === 0) {
      const sentences = clippedText
        .split(/(?<=[.!?])\s+|\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 25 && s.length <= 240);

      for (let i = 0; i < questionCount; i++) {
        const fact =
          sentences[i % Math.max(1, sentences.length)] ||
          `${subject.name} core concept #${i + 1}`;
        aiQuestions.push({
          question: `[${difficulty}] Based on the study note (${subject.courseCode}), which statement accurately describes concept #${i + 1}?`,
          optionA: fact,
          optionB: `An unrelated assumption outside ${subject.courseCode}`,
          optionC: `The opposite of "${fact.slice(0, 48)}..."`,
          optionD: 'None of the above statements apply',
          correctAnswer: 'A',
          explanation: includeExplanations
            ? `Directly supported by the uploaded note: "${fact}".`
            : '',
        });
      }
    }

    return {
      suggestedTitle,
      extractedCharacters: combinedSource.length,
      difficulty,
      questionCount: aiQuestions.length,
      questions: aiQuestions,
    };
  }

  /**
   * 11. POST /teacher/cbt
   * Create and publish timed CBT assessment
   */
  async createTeacherCBT(
    userId: string,
    payload: {
      title: string;
      courseCode: string;
      subjectId: string;
      classId: string;
      timeLimitMinutes?: number;
      totalPossibleMarks?: number;
      dueDate?: string;
      questions: Array<{
        question: string;
        options: string[];
        correctAnswer: string | number;
        explanation?: string;
      }>;
    },
  ) {
    if (
      !payload.title ||
      !payload.subjectId ||
      !payload.classId ||
      !payload.questions ||
      !Array.isArray(payload.questions) ||
      payload.questions.length === 0
    ) {
      throw new BadRequestException(
        'Invalid CBT payload: title, subjectId, classId, and at least 1 question are required.',
      );
    }

    const profile = await this.findTeacherProfile(userId);

    const subject = await this.prisma.schoolSubject.findUnique({
      where: { id: payload.subjectId },
    });
    if (!subject) {
      throw new NotFoundException('Course subject not found.');
    }

    const timeLimitMinutes = payload.timeLimitMinutes || 30;
    const timeLimitSeconds = timeLimitMinutes * 60;

    // Standardized quiz questions structure
    const formattedQuestions = {
      quiz_metadata: {
        title: payload.title.trim(),
        course_code: payload.courseCode || subject.courseCode,
        time_limit: timeLimitSeconds,
        total_marks: payload.totalPossibleMarks || 100,
        number_of_questions: payload.questions.length,
      },
      questions: payload.questions.map((q, idx) => ({
        id: idx + 1,
        question: q.question,
        options: q.options,
        correct_answer: q.correctAnswer,
        explanation: q.explanation || '',
      })),
    };

    const quiz = await this.prisma.quiz.create({
      data: {
        userId,
        schoolId: profile.schoolId,
        classId: payload.classId,
        subjectId: payload.subjectId,
        title: payload.title.trim(),
        courseCode: payload.courseCode || subject.courseCode,
        questions: formattedQuestions as any,
        timeLimit: timeLimitSeconds,
        totalPossibleMarks: payload.totalPossibleMarks || 100,
        isClassCbt: true,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      },
      include: {
        subject: true,
        schoolClass: true,
      },
    });

    // Notify students of this class
    const enrolledStudents = await this.prisma.studentProfile.findMany({
      where: { classId: payload.classId },
      select: { userId: true },
    });

    for (const student of enrolledStudents) {
      this.notificationsService
        .dispatchNotification({
          userId: student.userId,
          schoolId: profile.schoolId,
          title: `⏱️ Timed CBT Assessment Published: ${quiz.title}`,
          body: `New online assessment for ${quiz.courseCode} (${timeLimitMinutes} mins). Tap to start.`,
          category: 'SCHOOL',
          deepLink: `/quizDetails?quizId=${quiz.id}`,
        })
        .catch(() => {});
    }

    return quiz;
  }

  /**
   * 12. GET /teacher/cbt/:id/submissions
   * View all student scores and submissions for this CBT test
   */
  async getCBTSubmissions(userId: string, quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        subject: true,
        schoolClass: true,
      },
    });

    if (!quiz) {
      throw new NotFoundException('CBT Assessment not found.');
    }

    const submissions = await this.prisma.cbtSubmission.findMany({
      where: { quizId },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            loginId: true,
            studentProfile: {
              select: {
                matricOrAdmissionNo: true,
                level: true,
              },
            },
          },
        },
      },
      orderBy: { percentage: 'desc' },
    });

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        courseCode: quiz.courseCode,
        className: quiz.schoolClass?.name,
        subjectName: quiz.subject?.name,
        totalPossibleMarks: quiz.totalPossibleMarks,
        timeLimit: quiz.timeLimit,
      },
      submissions: submissions.map((sub) => ({
        id: sub.id,
        studentId: sub.studentId,
        studentName: sub.student.fullName || 'Student',
        email: sub.student.email,
        avatarUrl: sub.student.avatarUrl,
        matricOrAdmissionNo:
          sub.student.studentProfile?.matricOrAdmissionNo ||
          sub.student.loginId ||
          'N/A',
        score: sub.score,
        percentage: sub.percentage,
        totalMarks: sub.totalMarks,
        totalPossibleMarks: sub.totalPossibleMarks,
        submittedAt: sub.submittedAt.toISOString(),
      })),
    };
  }

  /**
   * 13. POST /teacher/cbt/:id/submit
   * Record a student's completed CBT submission
   */
  async submitCBT(
    studentId: string,
    quizId: string,
    payload: {
      score: number;
      percentage: number;
      totalMarks: number;
      totalPossibleMarks: number;
      answersJson?: any;
    },
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
    });
    if (!quiz) {
      throw new NotFoundException('CBT Assessment not found.');
    }

    const submission = await this.prisma.cbtSubmission.upsert({
      where: {
        quizId_studentId: {
          quizId,
          studentId,
        },
      },
      update: {
        score: Number(payload.score) || 0,
        percentage: Number(payload.percentage) || 0,
        totalMarks: Number(payload.totalMarks) || 0,
        totalPossibleMarks: Number(payload.totalPossibleMarks) || 100,
        answersJson: payload.answersJson || null,
        submittedAt: new Date(),
      },
      create: {
        quizId,
        studentId,
        score: Number(payload.score) || 0,
        percentage: Number(payload.percentage) || 0,
        totalMarks: Number(payload.totalMarks) || 0,
        totalPossibleMarks: Number(payload.totalPossibleMarks) || 100,
        answersJson: payload.answersJson || null,
      },
    });

    return submission;
  }

  /**
   * 14. GET /teacher/student/assessments
   * Student endpoint to fetch class handouts and CBT tests for their enrolled class
   */
  async getStudentAssessments(studentId: string) {
    const studentProfile = await this.prisma.studentProfile.findFirst({
      where: { userId: studentId },
    });

    if (!studentProfile || !studentProfile.classId) {
      return { classNotes: [], classCbtQuizzes: [] };
    }

    const classNotes = await this.prisma.note.findMany({
      where: {
        classId: studentProfile.classId,
        isClassNote: true,
      },
      include: {
        user: { select: { fullName: true } },
        subject: { select: { name: true, courseCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const classCbtQuizzes = await this.prisma.quiz.findMany({
      where: {
        classId: studentProfile.classId,
        isClassCbt: true,
      },
      include: {
        user: { select: { fullName: true } },
        subject: { select: { name: true, courseCode: true } },
        cbtSubmissions: {
          where: { studentId },
          select: {
            id: true,
            percentage: true,
            totalMarks: true,
            submittedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      classNotes: classNotes.map((n) => ({
        id: n.id,
        title: n.title,
        summary: n.summary,
        courseCode: n.courseCode,
        fileUrl: n.fileUrl,
        subjectName: n.subject?.name,
        teacherName: n.user.fullName,
        createdAt: n.createdAt.toISOString(),
      })),
      classCbtQuizzes: classCbtQuizzes.map((q) => ({
        id: q.id,
        title: q.title,
        courseCode: q.courseCode,
        subjectName: q.subject?.name,
        teacherName: q.user.fullName,
        timeLimit: q.timeLimit,
        dueDate: q.dueDate ? q.dueDate.toISOString() : null,
        submission: q.cbtSubmissions[0] || null,
        createdAt: q.createdAt.toISOString(),
      })),
    };
  }
}
