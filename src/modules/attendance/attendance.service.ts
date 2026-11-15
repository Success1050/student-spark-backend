import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export type RollCallEntryInput = {
  studentId: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
};

type AttendanceScope = {
  mode: 'CLASS' | 'SUBJECT';
  schoolId: string;
  schoolName: string;
  institutionType: string;
  isTertiary: boolean;
  classId: string;
  className: string;
  levelCode: string | null;
  departmentName: string;
  subjectId: string | null;
  displayCode: string;
  displayName: string;
  defaultThreshold: number;
  isFormTeacher: boolean;
  canEdit: boolean;
};

/**
 * Day 13: Smart Digital Attendance & Configurable Exam Eligibility Service
 * - Configurable exam eligibility percentage per course/subject or class (default 75%)
 * - Class-level daily attendance for Non-Tertiary schools (Form Teacher edit, subject teachers read-only)
 * - Subject/course-level attendance for Tertiary institutions
 * - 1-tap Teacher Roll Call logging (PRESENT / LATE / EXCUSED / ABSENT)
 * - 5-minute 4-digit Lecture/Class PIN generator & Student check-in
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getTermLockContext(
    userId: string | undefined,
    schoolId: string,
    opts?: { termId?: string; sessionDate?: Date | string; sessionId?: string },
  ) {
    let isAdmin = false;
    if (userId) {
      const [user, membership] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, schoolId: true },
        }),
        this.prisma.membership.findFirst({
          where: { userId, schoolId, status: 'ACTIVE' },
          select: { role: true },
        }),
      ]);
      if (user?.role === 'SUPER_ADMIN') {
        isAdmin = true;
      } else if (
        user?.role === 'SCHOOL_ADMIN' &&
        (!user.schoolId || user.schoolId === schoolId)
      ) {
        isAdmin = true;
      } else if (
        membership &&
        (membership.role === 'SCHOOL_ADMIN' || membership.role === 'SUPER_ADMIN')
      ) {
        isAdmin = true;
      }
    }

    let targetDate: Date | null = null;
    if (opts?.sessionId) {
      const existingSession = await this.prisma.attendanceSession.findUnique({
        where: { id: opts.sessionId },
        select: { sessionDate: true },
      });
      if (existingSession?.sessionDate) {
        targetDate = new Date(existingSession.sessionDate);
      }
    } else if (opts?.sessionDate) {
      const parsed =
        opts.sessionDate instanceof Date
          ? opts.sessionDate
          : new Date(opts.sessionDate);
      if (!Number.isNaN(parsed.getTime())) {
        targetDate = parsed;
      }
    }

    const sessions = await this.prisma.academicSession.findMany({
      where: { schoolId },
      include: { terms: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const allTerms = sessions.flatMap((s) => s.terms);

    let targetTerm = opts?.termId
      ? allTerms.find((t) => t.id === opts.termId)
      : undefined;

    if (!targetTerm && targetDate) {
      const ts = targetDate.getTime();
      targetTerm = allTerms.find((t) => {
        if (!t.startDate || !t.endDate) return false;
        const start = new Date(t.startDate).setUTCHours(0, 0, 0, 0);
        const end = new Date(t.endDate).setUTCHours(23, 59, 59, 999);
        return ts >= start && ts <= end;
      });
    }

    if (!targetTerm) {
      targetTerm =
        allTerms.find((t) => t.isCurrent) ||
        sessions.find((s) => s.isCurrent)?.terms?.[0] ||
        allTerms[0];
    }

    const isClosed = Boolean(targetTerm?.isClosed);
    const isDisabled = Boolean(
      targetTerm &&
        !targetTerm.isEnabled &&
        !targetTerm.isCurrent &&
        !targetTerm.isClosed,
    );
    const isLockedForUser = !isAdmin && (isClosed || isDisabled);

    const lockMessage = isClosed
      ? `${targetTerm?.name || 'This academic term'} is officially closed. Taking or editing student attendance is locked for teachers — only the School Admin can modify closed-term records. E-Library, Note Generation, CBT Generation, and other non-record portals remain available.`
      : isDisabled
        ? `${targetTerm?.name || 'This academic term'} has not been enabled by the School Admin yet.`
        : null;

    return {
      isAdmin,
      targetTerm: targetTerm ?? null,
      isClosed,
      isDisabled,
      isLockedForUser,
      lockMessage,
    };
  }

  private async assertAttendanceEditableForUser(
    userId: string | undefined,
    schoolId: string,
    opts?: { termId?: string; sessionDate?: Date | string; sessionId?: string },
  ) {
    const ctx = await this.getTermLockContext(userId, schoolId, opts);
    if (ctx.isLockedForUser) {
      throw new ForbiddenException(
        ctx.lockMessage ||
          'This academic term is locked. Only the School Admin can modify student attendance.',
      );
    }
    return ctx;
  }

  private async resolveSubjectScope(
    userId: string,
    subjectId: string,
  ): Promise<AttendanceScope> {
    const subject = await this.prisma.schoolSubject.findUnique({
      where: { id: subjectId },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            institutionType: true,
            defaultMinAttendancePercent: true,
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
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        assignedTeachers: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    if (!subject) {
      throw new NotFoundException('Course / Subject not found.');
    }

    const subjectIsTertiary = this.isTertiaryInstitution(
      subject.school?.institutionType,
    );
    const isFormTeacher = subjectIsTertiary
      ? false
      : subject.schoolClass.formTeacherId === userId;
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, schoolId: true },
      });

      if (user && user.role === 'TEACHER') {
        const isDirectTeacher = subject.teacherId === userId;
        const isAssignedProfile = subject.assignedTeachers.some(
          (t) => t.userId === userId,
        );
        const handlesClassAllSubjects = subjectIsTertiary
          ? null
          : await this.prisma.teacherProfile.findFirst({
              where: {
                userId,
                handlesAllSubjects: true,
                assignedClasses: { some: { id: subject.classId } },
              },
              select: { id: true },
            });

        if (
          !isDirectTeacher &&
          !isAssignedProfile &&
          !isFormTeacher &&
          !handlesClassAllSubjects
        ) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to manage attendance for this course.',
          );
        }
      }
    }

    const instType = subject.school?.institutionType || 'SECONDARY';
    return {
      mode: 'SUBJECT',
      schoolId: subject.schoolId,
      schoolName: subject.school?.name || 'School',
      institutionType: instType,
      isTertiary: this.isTertiaryInstitution(instType),
      classId: subject.classId,
      className: subject.schoolClass.name,
      levelCode: subject.schoolClass.levelCode,
      departmentName: subject.department?.name || 'General',
      subjectId: subject.id,
      displayCode: subject.courseCode,
      displayName: subject.name,
      defaultThreshold:
        subject.minAttendancePercent ??
        subject.school?.defaultMinAttendancePercent ??
        75,
      isFormTeacher,
      canEdit: true,
    };
  }

  private async resolveClassScope(
    userId: string,
    classId: string,
    requireWrite = false,
  ): Promise<AttendanceScope> {
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
        department: {
          select: { id: true, name: true, code: true },
        },
        teacherProfiles: {
          select: { id: true, userId: true },
        },
        subjects: {
          select: {
            id: true,
            teacherId: true,
            assignedTeachers: { select: { userId: true } },
          },
        },
      },
    });

    if (!schoolClass) {
      throw new NotFoundException('Class / Arm not found.');
    }

    const instType = schoolClass.school?.institutionType || 'SECONDARY';
    const isTertiary = this.isTertiaryInstitution(instType);
    const isFormTeacher = schoolClass.formTeacherId === userId;
    let canEdit = true;

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, schoolId: true },
      });

      if (user?.role === 'SCHOOL_ADMIN' || user?.role === 'SUPER_ADMIN') {
        canEdit = true;
      } else if (user?.role === 'TEACHER') {
        const isAssignedClassTeacher = schoolClass.teacherProfiles.some(
          (t) => t.userId === userId,
        );
        const teachesSubjectInClass = schoolClass.subjects.some(
          (sub) =>
            sub.teacherId === userId ||
            sub.assignedTeachers.some((t) => t.userId === userId),
        );

        if (!isFormTeacher && !isAssignedClassTeacher && !teachesSubjectInClass) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to this class or any of its subjects.',
          );
        }

        if (isTertiary) {
          throw new ForbiddenException(
            'Attendance in tertiary institutions must be taken per assigned course, not per class.',
          );
        }

        canEdit = isFormTeacher;
        if (requireWrite && !canEdit) {
          throw new ForbiddenException(
            'Read-only access: Only the assigned Form Teacher for this class (or a School Admin) can mark or edit daily class attendance.',
          );
        }
      }
    }

    return {
      mode: 'CLASS',
      schoolId: schoolClass.schoolId,
      schoolName: schoolClass.school?.name || 'School',
      institutionType: instType,
      isTertiary,
      classId: schoolClass.id,
      className: schoolClass.name,
      levelCode: schoolClass.levelCode,
      departmentName: schoolClass.department?.name || 'General',
      subjectId: null,
      displayCode: schoolClass.name,
      displayName: `${schoolClass.name} Daily Register`,
      defaultThreshold:
        schoolClass.minAttendancePercent ??
        schoolClass.school?.defaultMinAttendancePercent ??
        75,
      isFormTeacher,
      canEdit,
    };
  }

  private buildSessionScopeWhere(scope: AttendanceScope) {
    return scope.mode === 'CLASS'
      ? { classId: scope.classId, subjectId: null }
      : { subjectId: scope.subjectId! };
  }

  /**
   * Fetch all enrolled students in a class cohort (via StudentProfile + User fallback)
   */
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
        orderBy: {
          user: { fullName: 'asc' },
        },
      }),
      this.prisma.user.findMany({
        where: {
          schoolId,
          classId,
          role: 'STUDENT',
        },
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
        fullName: p.user.fullName || 'Student',
        email: p.user.email,
        avatarUrl: p.user.avatarUrl,
        matricOrAdmissionNo:
          p.matricOrAdmissionNo ||
          p.user.loginId ||
          p.user.studentCode ||
          'N/A',
      });
    }

    for (const u of directUsers) {
      if (!studentMap.has(u.id)) {
        studentMap.set(u.id, {
          studentId: u.id,
          fullName: u.fullName || 'Student',
          email: u.email,
          avatarUrl: u.avatarUrl,
          matricOrAdmissionNo: u.loginId || u.studentCode || 'N/A',
        });
      }
    }

    return Array.from(studentMap.values());
  }

  private isTertiaryInstitution(institutionType?: string | null): boolean {
    return (
      institutionType === 'UNIVERSITY' ||
      institutionType === 'POLYTECHNIC' ||
      institutionType === 'COLLEGE_OF_EDUCATION' ||
      institutionType === 'TECHNICAL'
    );
  }

  private parseDayRange(dateStr?: string) {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    let day = now.getDate();

    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
      const [y, m, d] = dateStr.trim().split('-').map(Number);
      year = y;
      month = m - 1;
      day = d;
    }

    const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
    const noonOfDay = new Date(year, month, day, 12, 0, 0, 0);
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999);
    const yyyy = String(year);
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return {
      isoDate: `${yyyy}-${mm}-${dd}`,
      startOfDay,
      noonOfDay,
      endOfDay,
    };
  }

  private toLocalDateStr(d: Date | string): string {
    const date = new Date(d);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private escapeCsv(val: string | number | boolean | null | undefined): string {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /** Format as text like "Thu 12 Nov 2026" so spreadsheets never collapse dates into ######### */
  private formatCsvDisplayDate(d: Date | string): string {
    const dt = new Date(d);
    const weekday = dt.toLocaleDateString('en-US', { weekday: 'short' });
    const day = dt.toLocaleDateString('en-US', { day: '2-digit' });
    const month = dt.toLocaleDateString('en-US', { month: 'short' });
    const year = dt.getFullYear();
    return `${weekday} ${day} ${month} ${year}`;
  }

  private formatCsvTime(isoStr: string | null | undefined): string {
    if (!isoStr) return 'Roll Call';
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  async getSubjectAttendanceSummary(
    subjectId: string,
    overrideThreshold?: number,
    userId?: string,
    targetDate?: string,
    termId?: string,
  ) {
    const scope = await this.resolveSubjectScope(userId || '', subjectId);
    return this.getAttendanceSummaryForScope(
      scope,
      overrideThreshold,
      targetDate,
      termId,
      userId,
    );
  }

  async getClassAttendanceSummary(
    classId: string,
    overrideThreshold?: number,
    userId?: string,
    targetDate?: string,
    termId?: string,
  ) {
    const scope = await this.resolveClassScope(userId || '', classId, false);
    return this.getAttendanceSummaryForScope(
      scope,
      overrideThreshold,
      targetDate,
      termId,
      userId,
    );
  }

  private async getAttendanceSummaryForScope(
    scope: AttendanceScope,
    overrideThreshold?: number,
    targetDate?: string,
    termId?: string,
    userId?: string,
  ) {
    const dayRange = this.parseDayRange(targetDate);

    const configuredThresholdPercentage =
      overrideThreshold !== undefined && !Number.isNaN(overrideThreshold)
        ? Math.min(100, Math.max(10, Number(overrideThreshold)))
        : scope.defaultThreshold;

    const [allSessions, students, sessionsMeta] = await Promise.all([
      this.prisma.attendanceSession.findMany({
        where: this.buildSessionScopeWhere(scope),
        include: {
          records: true,
        },
        orderBy: { sessionDate: 'desc' },
      }),
      this.getEnrolledStudentsForClass(scope.schoolId, scope.classId),
      this.prisma.academicSession.findMany({
        where: { schoolId: scope.schoolId },
        include: { terms: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const terms = sessionsMeta.flatMap((s) =>
      s.terms.map((t) => ({
        id: t.id,
        name: `${s.name} - ${t.name}`,
        shortName: t.name,
        sessionName: s.name,
        isCurrent: t.isCurrent,
        isEnabled: t.isEnabled,
        isClosed: t.isClosed,
        startDate: t.startDate?.toISOString() ?? null,
        endDate: t.endDate?.toISOString() ?? null,
      })),
    );

    const termLock = await this.getTermLockContext(userId, scope.schoolId, {
      termId,
      sessionDate: targetDate || dayRange.isoDate,
    });
    const effectiveCanEdit = termLock.isAdmin
      ? scope.canEdit
      : scope.canEdit && !termLock.isLockedForUser;

    const selectedTerm = termId ? terms.find((t) => t.id === termId) : undefined;
    const sessions =
      selectedTerm?.startDate && selectedTerm?.endDate
        ? allSessions.filter((s) => {
            const t = new Date(s.sessionDate).getTime();
            return (
              t >= new Date(selectedTerm.startDate!).getTime() &&
              t <= new Date(selectedTerm.endDate!).getTime()
            );
          })
        : allSessions;

    const totalSessions = sessions.length;
    const now = new Date();

    const activePinRaw = allSessions.find(
      (s) => s.pinCode && s.pinExpiresAt && new Date(s.pinExpiresAt) > now,
    );

    const activePinSession = activePinRaw
      ? {
          id: activePinRaw.id,
          pinCode: activePinRaw.pinCode,
          pinExpiresAt: activePinRaw.pinExpiresAt?.toISOString() || null,
          sessionDate: activePinRaw.sessionDate.toISOString(),
          checkedInCount: activePinRaw.records.filter(
            (r) => r.status === 'PRESENT' || r.status === 'LATE',
          ).length,
          remainingSeconds: Math.max(
            0,
            Math.floor(
              (new Date(activePinRaw.pinExpiresAt!).getTime() - now.getTime()) /
                1000,
            ),
          ),
        }
      : null;

    const selectedDaySession =
      allSessions.find((s) => {
        const dt = new Date(s.sessionDate);
        return dt >= dayRange.startOfDay && dt <= dayRange.endOfDay;
      }) || null;

    const roster = students.map((student) => {
      let presentCount = 0;
      let lateCount = 0;
      let excusedCount = 0;
      let absentCount = 0;

      for (const session of sessions) {
        const record = session.records.find(
          (r) => r.studentId === student.studentId,
        );
        if (!record) {
          absentCount += 1;
        } else if (record.status === 'PRESENT') {
          presentCount += 1;
        } else if (record.status === 'LATE') {
          lateCount += 1;
        } else if (record.status === 'EXCUSED') {
          excusedCount += 1;
        } else {
          absentCount += 1;
        }
      }

      const attendedCount = presentCount + lateCount + excusedCount;
      const attendancePercent =
        totalSessions > 0
          ? Math.round((attendedCount / totalSessions) * 100)
          : 100;

      const examEligible =
        totalSessions === 0
          ? true
          : attendancePercent >= configuredThresholdPercentage;

      const dayRecord = selectedDaySession?.records.find(
        (r) => r.studentId === student.studentId,
      );

      return {
        ...student,
        presentCount,
        lateCount,
        excusedCount,
        absentCount,
        attendedCount,
        totalSessions,
        attendancePercent,
        minAttendancePercent: configuredThresholdPercentage,
        examEligible,
        todayStatus: dayRecord ? dayRecord.status : null,
      };
    });

    const studentsBelowThreshold = roster.filter((r) => !r.examEligible);
    const eligibleCount = roster.length - studentsBelowThreshold.length;
    const averageAttendancePercent =
      roster.length > 0
        ? Math.round(
            roster.reduce((acc, r) => acc + r.attendancePercent, 0) /
              roster.length,
          )
        : 100;

    const recentSessions = sessions.slice(0, 60).map((s) => {
      const presentCount = s.records.filter(
        (r) => r.status === 'PRESENT',
      ).length;
      const lateCount = s.records.filter((r) => r.status === 'LATE').length;
      const excusedCount = s.records.filter(
        (r) => r.status === 'EXCUSED',
      ).length;
      const absentCount = Math.max(
        0,
        students.length - (presentCount + lateCount + excusedCount),
      );

      return {
        id: s.id,
        sessionDate: s.sessionDate.toISOString(),
        dateStr: this.toLocalDateStr(s.sessionDate),
        pinCode: s.pinCode,
        pinExpiresAt: s.pinExpiresAt?.toISOString() || null,
        presentCount,
        lateCount,
        excusedCount,
        absentCount,
        totalStudents: students.length,
      };
    });

    const recordedDates = Array.from(
      new Set(allSessions.map((s) => this.toLocalDateStr(s.sessionDate))),
    );

    return {
      mode: scope.mode,
      isFormTeacher: scope.isFormTeacher,
      canEdit: effectiveCanEdit,
      isTermClosed: termLock.isClosed,
      isTermDisabled: termLock.isDisabled,
      termLockReason: termLock.isLockedForUser ? termLock.lockMessage : null,
      classId: scope.classId,
      subjectId: scope.subjectId,
      subject: {
        id: scope.subjectId || scope.classId,
        name: scope.displayName,
        courseCode: scope.displayCode,
        creditUnits: 0,
        classId: scope.classId,
        className: scope.className,
        levelCode: scope.levelCode,
        departmentName: scope.departmentName,
        minAttendancePercent: configuredThresholdPercentage,
        institutionType: scope.institutionType,
        isTertiary: scope.isTertiary,
      },
      configuredThresholdPercentage,
      selectedDate: dayRange.isoDate,
      selectedDateSessionId: selectedDaySession?.id || null,
      todaySessionId: selectedDaySession?.id || null,
      recordedDates,
      terms,
      totalSessions,
      activePinSession,
      recentSessions,
      roster,
      studentsBelowThreshold,
      summaryStats: {
        totalStudents: roster.length,
        eligibleCount,
        belowThresholdCount: studentsBelowThreshold.length,
        averageAttendancePercent,
      },
    };
  }

  /**
   * 2. PATCH /attendance/subjects/:subjectId/threshold & /attendance/classes/:classId/threshold
   */
  async updateSubjectThreshold(
    userId: string,
    subjectId: string,
    minAttendancePercent: number,
  ) {
    const parsed = Number(minAttendancePercent);
    if (Number.isNaN(parsed) || parsed < 10 || parsed > 100) {
      throw new BadRequestException(
        'Minimum attendance benchmark must be between 10% and 100%.',
      );
    }

    const scope = await this.resolveSubjectScope(userId, subjectId);
    await this.assertAttendanceEditableForUser(userId, scope.schoolId);

    const updated = await this.prisma.schoolSubject.update({
      where: { id: subjectId },
      data: { minAttendancePercent: parsed },
    });

    return {
      subjectId: updated.id,
      courseCode: updated.courseCode,
      name: updated.name,
      minAttendancePercent: updated.minAttendancePercent,
      message: `Exam eligibility threshold for ${updated.courseCode} updated to ${updated.minAttendancePercent}%.`,
    };
  }

  async updateClassThreshold(
    userId: string,
    classId: string,
    minAttendancePercent: number,
  ) {
    const parsed = Number(minAttendancePercent);
    if (Number.isNaN(parsed) || parsed < 10 || parsed > 100) {
      throw new BadRequestException(
        'Minimum attendance benchmark must be between 10% and 100%.',
      );
    }

    const scope = await this.resolveClassScope(userId, classId, true);
    await this.assertAttendanceEditableForUser(userId, scope.schoolId);

    const updated = await this.prisma.schoolClass.update({
      where: { id: classId },
      data: { minAttendancePercent: parsed },
    });

    return {
      classId: updated.id,
      name: updated.name,
      minAttendancePercent: updated.minAttendancePercent,
      message: `Attendance cutoff for ${updated.name} updated to ${updated.minAttendancePercent}%.`,
    };
  }

  /**
   * 3. POST /attendance/sessions/pin
   * Generate a 5-minute 4-digit Lecture / Class PIN for student check-in
   */
  async generateLecturePin(
    userId: string,
    payload: {
      subjectId?: string;
      classId?: string;
      durationMinutes?: number;
      sessionId?: string;
    },
  ) {
    if (!payload.subjectId && !payload.classId) {
      throw new BadRequestException('Either subjectId or classId is required.');
    }

    const scope = payload.classId && !payload.subjectId
      ? await this.resolveClassScope(userId, payload.classId, true)
      : await this.resolveSubjectScope(userId, payload.subjectId!);
    await this.assertAttendanceEditableForUser(userId, scope.schoolId, {
      sessionId: payload.sessionId,
      sessionDate: new Date(),
    });

    const durationMinutes = Math.min(
      30,
      Math.max(1, Number(payload.durationMinutes || 5)),
    );

    const now = new Date();
    const pinExpiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    let pinCode = String(Math.floor(1000 + Math.random() * 9000));
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = await this.prisma.attendanceSession.findFirst({
        where: {
          schoolId: scope.schoolId,
          pinCode,
          pinExpiresAt: { gt: now },
        },
      });
      if (!collision) break;
      pinCode = String(Math.floor(1000 + Math.random() * 9000));
    }

    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    let session = payload.sessionId
      ? await this.prisma.attendanceSession.findUnique({
          where: { id: payload.sessionId },
        })
      : await this.prisma.attendanceSession.findFirst({
          where: {
            ...this.buildSessionScopeWhere(scope),
            sessionDate: { gte: threeHoursAgo },
          },
          orderBy: { sessionDate: 'desc' },
        });

    if (session) {
      session = await this.prisma.attendanceSession.update({
        where: { id: session.id },
        data: {
          pinCode,
          pinExpiresAt,
        },
      });
    } else {
      session = await this.prisma.attendanceSession.create({
        data: {
          schoolId: scope.schoolId,
          classId: scope.classId,
          subjectId: scope.subjectId,
          teacherId: userId,
          sessionDate: now,
          pinCode,
          pinExpiresAt,
        },
      });
    }

    const enrolledStudents = await this.getEnrolledStudentsForClass(
      scope.schoolId,
      scope.classId,
    );

    void Promise.all(
      enrolledStudents.map((st) =>
        this.notificationsService.dispatchNotification({
          userId: st.studentId,
          schoolId: scope.schoolId,
          title:
            scope.mode === 'CLASS'
              ? `📍 Daily Roll Call Check-In: ${scope.className}`
              : `📍 Lecture Check-In Open: ${scope.displayCode}`,
          body: `Enter 4-digit PIN ${pinCode} within ${durationMinutes} minutes to mark your attendance for ${scope.displayName}.`,
          category: 'SCHOOL',
          deepLink: '/attendance',
          dataJson: {
            type: 'LECTURE_PIN_OPEN',
            sessionId: session.id,
            classId: scope.classId,
            subjectId: scope.subjectId,
            courseCode: scope.displayCode,
          },
          channels: { inApp: true, push: true, email: false },
        }),
      ),
    );

    return {
      sessionId: session.id,
      classId: scope.classId,
      subjectId: scope.subjectId,
      courseCode: scope.displayCode,
      subjectName: scope.displayName,
      className: scope.className,
      pinCode,
      pinExpiresAt: pinExpiresAt.toISOString(),
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
    };
  }

  /**
   * 4. POST /attendance/sessions/roll-call
   * Teacher 1-tap bulk roll-call logging for an AttendanceSession (subject or class)
   */
  async recordRollCall(
    userId: string,
    payload: {
      subjectId?: string;
      classId?: string;
      sessionId?: string;
      sessionDate?: string;
      startNewSession?: boolean;
      records: RollCallEntryInput[];
    },
  ) {
    if (!payload.subjectId && !payload.classId) {
      throw new BadRequestException('Either subjectId or classId is required.');
    }
    if (!Array.isArray(payload.records) || payload.records.length === 0) {
      throw new BadRequestException(
        'At least one student attendance record is required.',
      );
    }

    const scope = payload.classId && !payload.subjectId
      ? await this.resolveClassScope(userId, payload.classId, true)
      : await this.resolveSubjectScope(userId, payload.subjectId!);

    const now = new Date();
    const dayRange = this.parseDayRange(payload.sessionDate);
    const isToday = dayRange.isoDate === this.toLocalDateStr(now);

    await this.assertAttendanceEditableForUser(userId, scope.schoolId, {
      sessionId: payload.sessionId,
      sessionDate: payload.sessionDate || dayRange.isoDate,
    });

    let session = null;
    if (payload.sessionId) {
      session = await this.prisma.attendanceSession.findUnique({
        where: { id: payload.sessionId },
      });
    } else if (!payload.startNewSession) {
      session = await this.prisma.attendanceSession.findFirst({
        where: {
          ...this.buildSessionScopeWhere(scope),
          sessionDate: {
            gte: dayRange.startOfDay,
            lte: dayRange.endOfDay,
          },
        },
        orderBy: { sessionDate: 'desc' },
      });
    }

    if (!session) {
      session = await this.prisma.attendanceSession.create({
        data: {
          schoolId: scope.schoolId,
          classId: scope.classId,
          subjectId: scope.subjectId,
          teacherId: userId,
          sessionDate: isToday ? now : dayRange.noonOfDay,
        },
      });
    }

    const validStatuses = new Set(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

    await this.prisma.$transaction(
      payload.records.map((entry) => {
        const normalizedStatus = validStatuses.has(
          String(entry.status).toUpperCase(),
        )
          ? (String(entry.status).toUpperCase() as AttendanceStatus)
          : AttendanceStatus.PRESENT;

        return this.prisma.attendanceRecord.upsert({
          where: {
            sessionId_studentId: {
              sessionId: session.id,
              studentId: entry.studentId,
            },
          },
          update: {
            status: normalizedStatus,
            checkedInAt: now,
          },
          create: {
            sessionId: session.id,
            studentId: entry.studentId,
            status: normalizedStatus,
            checkedInAt: now,
          },
        });
      }),
    );

    const updatedSummary = await this.getAttendanceSummaryForScope(
      scope,
      undefined,
      dayRange.isoDate,
    );

    if (updatedSummary.totalSessions >= 2) {
      const absentStudentIds = new Set(
        payload.records
          .filter((r) => String(r.status).toUpperCase() === 'ABSENT')
          .map((r) => r.studentId),
      );

      const newlyAtRisk = updatedSummary.studentsBelowThreshold.filter((st) =>
        absentStudentIds.has(st.studentId),
      );

      void Promise.all(
        newlyAtRisk.map((st) =>
          this.notificationsService.dispatchNotification({
            userId: st.studentId,
            schoolId: scope.schoolId,
            title: `⚠️ Attendance Alert: ${scope.displayCode}`,
            body: `Your attendance in ${scope.displayName} is ${st.attendancePercent}% (${st.attendedCount}/${st.totalSessions} days), below the ${updatedSummary.configuredThresholdPercentage}% requirement.`,
            category: 'SCHOOL',
            deepLink: '/attendance',
            channels: { inApp: true, push: true, email: true },
            emailSubject: `⚠️ Attendance Alert: ${scope.displayName}`,
          }),
        ),
      );
    }

    return {
      sessionId: session.id,
      recordedCount: payload.records.length,
      summary: updatedSummary,
    };
  }

  /**
   * 5. POST /attendance/check-in
   * Student checks into an active lecture session using the 4-digit PIN
   */
  async studentPinCheckIn(
    studentId: string,
    payload: { pinCode: string; subjectId?: string },
  ) {
    const cleanPin = String(payload.pinCode || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      throw new BadRequestException(
        'Please enter a valid 4-digit numeric Lecture PIN.',
      );
    }

    const [user, studentProfile] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: studentId },
        select: { id: true, fullName: true, schoolId: true, classId: true },
      }),
      this.prisma.studentProfile.findFirst({
        where: { userId: studentId },
        select: { id: true, schoolId: true, classId: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('Student account not found.');
    }

    const effectiveSchoolId = studentProfile?.schoolId || user.schoolId;
    const effectiveClassId = studentProfile?.classId || user.classId;

    const whereClause: Record<string, unknown> = {
      pinCode: cleanPin,
    };
    if (payload.subjectId) {
      whereClause.subjectId = payload.subjectId;
    }
    if (effectiveSchoolId) {
      whereClause.schoolId = effectiveSchoolId;
    }

    const session = await this.prisma.attendanceSession.findFirst({
      where: whereClause,
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            courseCode: true,
            minAttendancePercent: true,
            classId: true,
          },
        },
        schoolClass: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { sessionDate: 'desc' },
    });

    if (!session) {
      throw new BadRequestException(
        'Invalid Lecture PIN. Please verify the 4-digit code with your lecturer.',
      );
    }

    if (effectiveClassId && session.classId !== effectiveClassId) {
      const targetCode = session.subject?.courseCode || session.schoolClass.name;
      throw new ForbiddenException(
        `This Check-In PIN belongs to ${session.schoolClass.name} (${targetCode}), which is outside your enrolled class cohort.`,
      );
    }

    const now = new Date();
    if (!session.pinExpiresAt || new Date(session.pinExpiresAt) < now) {
      throw new BadRequestException(
        'This Check-In PIN has expired. Please ask your teacher/lecturer to regenerate the PIN or mark you via roll call.',
      );
    }

    if (
      effectiveSchoolId &&
      session.sessionDate
    ) {
      await this.assertAttendanceEditableForUser(studentId, effectiveSchoolId, {
        sessionId: session.id,
        sessionDate: session.sessionDate,
      });
    }

    const record = await this.prisma.attendanceRecord.upsert({
      where: {
        sessionId_studentId: {
          sessionId: session.id,
          studentId,
        },
      },
      update: {
        status: AttendanceStatus.PRESENT,
        checkedInAt: now,
      },
      create: {
        sessionId: session.id,
        studentId,
        status: AttendanceStatus.PRESENT,
        checkedInAt: now,
      },
    });

    const scopeWhere = session.subjectId
      ? { subjectId: session.subjectId }
      : { classId: session.classId, subjectId: null };

    const allSessions = await this.prisma.attendanceSession.findMany({
      where: scopeWhere,
      include: {
        records: {
          where: { studentId },
        },
      },
    });

    const totalSessions = allSessions.length;
    const attendedCount = allSessions.filter((s) =>
      s.records.some(
        (r) =>
          r.status === 'PRESENT' ||
          r.status === 'LATE' ||
          r.status === 'EXCUSED',
      ),
    ).length;

    const attendancePercent =
      totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 100;
    const minAttendancePercent = session.subject?.minAttendancePercent ?? 75;
    const examEligible = attendancePercent >= minAttendancePercent;
    const displayCode = session.subject?.courseCode || session.schoolClass.name;
    const displayName =
      session.subject?.name || `${session.schoolClass.name} Daily Register`;

    return {
      checkedIn: true,
      message: `Checked in to ${displayCode} (${displayName})!`,
      record: {
        id: record.id,
        sessionId: session.id,
        status: record.status,
        checkedInAt: record.checkedInAt.toISOString(),
      },
      subject: {
        id: session.subject?.id || session.classId,
        courseCode: displayCode,
        name: displayName,
        attendedCount,
        totalSessions,
        attendancePercent,
        minAttendancePercent,
        examEligible,
      },
    };
  }

  /**
   * 6. GET /attendance/student/me
   * Student attendance dashboard: overall eligibility, active class PINs, per-course stats & history
   */
  async getStudentAttendanceOverview(studentId: string) {
    const [user, studentProfile] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: studentId },
        include: {
          school: {
            select: {
              id: true,
              name: true,
              institutionType: true,
              defaultMinAttendancePercent: true,
            },
          },
          schoolClass: {
            select: {
              id: true,
              name: true,
              levelCode: true,
              minAttendancePercent: true,
            },
          },
        },
      }),
      this.prisma.studentProfile.findFirst({
        where: { userId: studentId },
        include: {
          school: {
            select: {
              id: true,
              name: true,
              institutionType: true,
              defaultMinAttendancePercent: true,
            },
          },
          schoolClass: {
            select: {
              id: true,
              name: true,
              levelCode: true,
              minAttendancePercent: true,
            },
          },
        },
      }),
    ]);

    const school = studentProfile?.school || user?.school || null;
    const schoolClass = studentProfile?.schoolClass || user?.schoolClass || null;

    if (!school || !schoolClass) {
      return {
        enrolledInSchool: false,
        schoolName: null,
        institutionType: null,
        isTertiary: true,
        attendanceMode: 'SUBJECT' as const,
        className: null,
        levelCode: null,
        overallAttendancePercent: 100,
        overallExamEligible: true,
        eligibleCoursesCount: 0,
        totalCoursesCount: 0,
        classAttendance: null,
        activePinSessions: [],
        subjects: [],
        dailyLogs: [],
        recentRecords: [],
      };
    }

    const isTertiary = this.isTertiaryInstitution(school.institutionType);
    const now = new Date();
    const activePinSessions: Array<{
      sessionId: string;
      subjectId: string;
      courseCode: string;
      subjectName: string;
      pinExpiresAt: string;
      remainingSeconds: number;
      alreadyCheckedIn: boolean;
    }> = [];
    const dailyLogs: Array<{
      sessionId: string;
      dateStr: string;
      sessionDate: string;
      weekday: string;
      courseCode: string;
      scopeLabel: string;
      status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT';
      checkedInAt: string | null;
    }> = [];

    let subjectBreakdowns: Array<{
      subjectId: string;
      name: string;
      courseCode: string;
      creditUnits: number | null;
      minAttendancePercent: number;
      totalSessions: number;
      presentCount: number;
      lateCount: number;
      excusedCount: number;
      absentCount: number;
      attendedCount: number;
      attendancePercent: number;
      examEligible: boolean;
      sessionsNeededForEligibility: number;
    }> = [];

    let overallAttendancePercent = 100;
    let overallExamEligible = true;
    let eligibleCoursesCount = 0;
    let classAttendance: {
      classId: string;
      className: string;
      minAttendancePercent: number;
      totalSessions: number;
      presentCount: number;
      lateCount: number;
      excusedCount: number;
      absentCount: number;
      attendedCount: number;
      attendancePercent: number;
      examEligible: boolean;
      sessionsNeededForEligibility: number;
    } | null = null;

    if (!isTertiary) {
      // Non-tertiary schools (Primary / Secondary / K-12): attendance is taken by Class Form Register
      const classSessions = await this.prisma.attendanceSession.findMany({
        where: {
          schoolId: school.id,
          classId: schoolClass.id,
          subjectId: null,
        },
        include: {
          records: {
            where: { studentId },
          },
        },
        orderBy: { sessionDate: 'desc' },
      });

      const totalSessions = classSessions.length;
      let presentCount = 0;
      let lateCount = 0;
      let excusedCount = 0;
      let absentCount = 0;

      for (const session of classSessions) {
        const myRecord = session.records[0];
        const status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT' =
          myRecord?.status === 'PRESENT'
            ? 'PRESENT'
            : myRecord?.status === 'LATE'
            ? 'LATE'
            : myRecord?.status === 'EXCUSED'
            ? 'EXCUSED'
            : 'ABSENT';

        if (status === 'PRESENT') {
          presentCount += 1;
        } else if (status === 'LATE') {
          lateCount += 1;
        } else if (status === 'EXCUSED') {
          excusedCount += 1;
        } else {
          absentCount += 1;
        }

        const dateObj = new Date(session.sessionDate);
        dailyLogs.push({
          sessionId: session.id,
          dateStr: this.toLocalDateStr(dateObj),
          sessionDate: dateObj.toISOString(),
          weekday: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
          courseCode: schoolClass.levelCode || schoolClass.name,
          scopeLabel: `${schoolClass.name} Daily Register`,
          status,
          checkedInAt: myRecord?.checkedInAt
            ? myRecord.checkedInAt.toISOString()
            : null,
        });
      }

      const attendedCount = presentCount + lateCount + excusedCount;
      const minAttendancePercent =
        schoolClass.minAttendancePercent ??
        school.defaultMinAttendancePercent ??
        75;
      const attendancePercent =
        totalSessions > 0
          ? Math.round((attendedCount / totalSessions) * 100)
          : 100;
      const examEligible =
        totalSessions === 0 ? true : attendancePercent >= minAttendancePercent;

      let sessionsNeededForEligibility = 0;
      if (!examEligible && minAttendancePercent < 100) {
        const targetRatio = minAttendancePercent / 100;
        const needed = Math.ceil(
          (targetRatio * totalSessions - attendedCount) / (1 - targetRatio),
        );
        sessionsNeededForEligibility = Math.max(1, needed);
      }

      classAttendance = {
        classId: schoolClass.id,
        className: schoolClass.name,
        minAttendancePercent,
        totalSessions,
        presentCount,
        lateCount,
        excusedCount,
        absentCount,
        attendedCount,
        attendancePercent,
        examEligible,
        sessionsNeededForEligibility,
      };

      subjectBreakdowns = [
        {
          subjectId: schoolClass.id,
          name: `${schoolClass.name} Daily Class Attendance`,
          courseCode: schoolClass.levelCode || schoolClass.name,
          creditUnits: 0,
          minAttendancePercent,
          totalSessions,
          presentCount,
          lateCount,
          excusedCount,
          absentCount,
          attendedCount,
          attendancePercent,
          examEligible,
          sessionsNeededForEligibility,
        },
      ];

      overallAttendancePercent = attendancePercent;
      overallExamEligible = examEligible;
      eligibleCoursesCount = examEligible ? 1 : 0;
    } else {
      const subjects = await this.prisma.schoolSubject.findMany({
        where: {
          schoolId: school.id,
          classId: schoolClass.id,
        },
        include: {
          attendanceSessions: {
            include: {
              records: {
                where: { studentId },
              },
            },
            orderBy: { sessionDate: 'desc' },
          },
        },
        orderBy: { courseCode: 'asc' },
      });

      subjectBreakdowns = subjects.map((subj) => {
        const totalSessions = subj.attendanceSessions.length;
        let presentCount = 0;
        let lateCount = 0;
        let excusedCount = 0;
        let absentCount = 0;

        for (const session of subj.attendanceSessions) {
          const myRecord = session.records[0];

          if (
            session.pinCode &&
            session.pinExpiresAt &&
            new Date(session.pinExpiresAt) > now
          ) {
            activePinSessions.push({
              sessionId: session.id,
              subjectId: subj.id,
              courseCode: subj.courseCode,
              subjectName: subj.name,
              pinExpiresAt: session.pinExpiresAt.toISOString(),
              remainingSeconds: Math.max(
                0,
                Math.floor(
                  (new Date(session.pinExpiresAt).getTime() - now.getTime()) /
                    1000,
                ),
              ),
              alreadyCheckedIn: Boolean(
                myRecord &&
                  (myRecord.status === 'PRESENT' || myRecord.status === 'LATE'),
              ),
            });
          }

          const resolvedStatus: 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT' =
            myRecord?.status === 'PRESENT'
              ? 'PRESENT'
              : myRecord?.status === 'LATE'
              ? 'LATE'
              : myRecord?.status === 'EXCUSED'
              ? 'EXCUSED'
              : 'ABSENT';

          if (resolvedStatus === 'PRESENT') {
            presentCount += 1;
          } else if (resolvedStatus === 'LATE') {
            lateCount += 1;
          } else if (resolvedStatus === 'EXCUSED') {
            excusedCount += 1;
          } else {
            absentCount += 1;
          }

          const dateObj = new Date(session.sessionDate);
          dailyLogs.push({
            sessionId: session.id,
            dateStr: this.toLocalDateStr(dateObj),
            sessionDate: dateObj.toISOString(),
            weekday: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
            courseCode: subj.courseCode,
            scopeLabel: `${subj.courseCode} — ${subj.name}`,
            status: resolvedStatus,
            checkedInAt: myRecord?.checkedInAt
              ? myRecord.checkedInAt.toISOString()
              : null,
          });
        }

        const attendedCount = presentCount + lateCount + excusedCount;
        const minAttendancePercent =
          subj.minAttendancePercent ?? school.defaultMinAttendancePercent ?? 75;
        const attendancePercent =
          totalSessions > 0
            ? Math.round((attendedCount / totalSessions) * 100)
            : 100;
        const examEligible =
          totalSessions === 0
            ? true
            : attendancePercent >= minAttendancePercent;

        let sessionsNeededForEligibility = 0;
        if (!examEligible && minAttendancePercent < 100) {
          const targetRatio = minAttendancePercent / 100;
          const needed = Math.ceil(
            (targetRatio * totalSessions - attendedCount) / (1 - targetRatio),
          );
          sessionsNeededForEligibility = Math.max(1, needed);
        }

        return {
          subjectId: subj.id,
          name: subj.name,
          courseCode: subj.courseCode,
          creditUnits: subj.creditUnits,
          minAttendancePercent,
          totalSessions,
          presentCount,
          lateCount,
          excusedCount,
          absentCount,
          attendedCount,
          attendancePercent,
          examEligible,
          sessionsNeededForEligibility,
        };
      });

      const coursesWithSessions = subjectBreakdowns.filter(
        (s) => s.totalSessions > 0,
      );
      overallAttendancePercent =
        coursesWithSessions.length > 0
          ? Math.round(
              coursesWithSessions.reduce(
                (acc, s) => acc + s.attendancePercent,
                0,
              ) / coursesWithSessions.length,
            )
          : 100;

      eligibleCoursesCount = subjectBreakdowns.filter(
        (s) => s.examEligible,
      ).length;
      overallExamEligible =
        eligibleCoursesCount === subjectBreakdowns.length;
    }

    const recentRecordsRaw = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        ...(!isTertiary
          ? {
              session: {
                schoolId: school.id,
                subjectId: null,
              },
            }
          : {}),
      },
      include: {
        session: {
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
        },
      },
      orderBy: [{ session: { sessionDate: 'desc' } }, { checkedInAt: 'desc' }],
      take: isTertiary ? 30 : 60,
    });

    const activeClassPins = await this.prisma.attendanceSession.findMany({
      where: {
        schoolId: school.id,
        classId: schoolClass.id,
        subjectId: null,
        pinCode: { not: null },
        pinExpiresAt: { gt: now },
      },
      include: { records: { where: { studentId } } },
    });

    for (const clsSess of activeClassPins) {
      const myRecord = clsSess.records[0];
      activePinSessions.push({
        sessionId: clsSess.id,
        subjectId: schoolClass.id,
        courseCode: schoolClass.name,
        subjectName: `${schoolClass.name} Daily Register`,
        pinExpiresAt: clsSess.pinExpiresAt!.toISOString(),
        remainingSeconds: Math.max(
          0,
          Math.floor(
            (new Date(clsSess.pinExpiresAt!).getTime() - now.getTime()) / 1000,
          ),
        ),
        alreadyCheckedIn: Boolean(
          myRecord &&
            (myRecord.status === 'PRESENT' || myRecord.status === 'LATE'),
        ),
      });
    }

    const recentRecords = recentRecordsRaw.map((r) => {
      const classLabel = r.session.schoolClass?.name || schoolClass.name;
      return {
        id: r.id,
        sessionId: r.sessionId,
        status: r.status,
        checkedInAt: r.checkedInAt.toISOString(),
        sessionDate: r.session.sessionDate.toISOString(),
        dateStr: this.toLocalDateStr(r.session.sessionDate),
        weekday: r.session.sessionDate.toLocaleDateString('en-US', {
          weekday: 'short',
        }),
        subjectId: isTertiary
          ? r.session.subject?.id || r.session.classId
          : r.session.classId,
        courseCode: isTertiary
          ? r.session.subject?.courseCode || classLabel || 'CLASS'
          : classLabel || 'CLASS',
        subjectName: isTertiary
          ? r.session.subject?.name || `${classLabel} Daily Register`
          : `${classLabel} Daily Attendance`,
      };
    });

    dailyLogs.sort(
      (a, b) =>
        new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime(),
    );

    return {
      enrolledInSchool: true,
      schoolName: school.name,
      institutionType: school.institutionType,
      isTertiary,
      attendanceMode: isTertiary ? ('SUBJECT' as const) : ('CLASS' as const),
      className: schoolClass.name,
      levelCode: schoolClass.levelCode,
      overallAttendancePercent,
      overallExamEligible,
      eligibleCoursesCount,
      totalCoursesCount: subjectBreakdowns.length,
      classAttendance,
      activePinSessions,
      subjects: subjectBreakdowns,
      dailyLogs,
      recentRecords,
    };
  }

  /**
   * 6. GET /attendance/subjects/:subjectId/sessions/:sessionId/detail
   * &  GET /attendance/classes/:classId/sessions/:sessionId/detail
   */
  async getDailySessionDetail(
    userId: string,
    subjectId: string,
    sessionId: string,
  ) {
    const scope = await this.resolveSubjectScope(userId, subjectId);
    return this.getDailySessionDetailForScope(scope, sessionId);
  }

  async getClassDailySessionDetail(
    userId: string,
    classId: string,
    sessionId: string,
  ) {
    const scope = await this.resolveClassScope(userId, classId, false);
    return this.getDailySessionDetailForScope(scope, sessionId);
  }

  private async getDailySessionDetailForScope(
    scope: AttendanceScope,
    sessionId: string,
  ) {
    const [session, students] = await Promise.all([
      this.prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        include: { records: true },
      }),
      this.getEnrolledStudentsForClass(scope.schoolId, scope.classId),
    ]);

    const matchesScope =
      session &&
      (scope.mode === 'CLASS'
        ? session.classId === scope.classId && !session.subjectId
        : session.subjectId === scope.subjectId);

    if (!matchesScope || !session) {
      throw new NotFoundException('Attendance session not found.');
    }

    const recordMap = new Map(session.records.map((r) => [r.studentId, r]));
    const rows = students.map((st, idx) => {
      const rec = recordMap.get(st.studentId);
      return {
        sn: idx + 1,
        studentId: st.studentId,
        fullName: st.fullName,
        matricOrAdmissionNo: st.matricOrAdmissionNo,
        status: rec?.status ?? ('ABSENT' as AttendanceStatus),
        checkedInAt: rec?.checkedInAt?.toISOString() ?? null,
      };
    });

    const presentCount = rows.filter((r) => r.status === 'PRESENT').length;
    const lateCount = rows.filter((r) => r.status === 'LATE').length;
    const excusedCount = rows.filter((r) => r.status === 'EXCUSED').length;
    const absentCount = rows.filter((r) => r.status === 'ABSENT').length;

    const dateObj = new Date(session.sessionDate);
    const dateStr = this.toLocalDateStr(dateObj);
    const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const displayDate = this.formatCsvDisplayDate(dateObj);

    const csvLines = [
      'S/N,Student Name,ID No,Course / Scope,Class,Date,Status,Time / Mode',
      ...rows.map((r) =>
        [
          r.sn,
          this.escapeCsv(r.fullName),
          this.escapeCsv(r.matricOrAdmissionNo),
          this.escapeCsv(scope.displayCode),
          this.escapeCsv(scope.className),
          this.escapeCsv(displayDate),
          r.status,
          this.escapeCsv(this.formatCsvTime(r.checkedInAt)),
        ].join(','),
      ),
    ];

    return {
      session: {
        id: session.id,
        sessionDate: session.sessionDate.toISOString(),
        dateStr,
        weekday,
      },
      subject: {
        id: scope.subjectId || scope.classId,
        name: scope.displayName,
        courseCode: scope.displayCode,
        className: scope.className,
        schoolName: scope.schoolName,
      },
      stats: {
        totalStudents: rows.length,
        presentCount,
        lateCount,
        excusedCount,
        absentCount,
      },
      records: rows,
      csvText: `\uFEFF${csvLines.join('\r\n')}`,
    };
  }

  /**
   * 7. GET /attendance/subjects/:subjectId/report & /attendance/classes/:classId/report
   */
  async getTermAttendanceReport(
    userId: string,
    subjectId: string,
    termId?: string,
  ) {
    const scope = await this.resolveSubjectScope(userId, subjectId);
    return this.getTermAttendanceReportForScope(scope, termId);
  }

  async getClassTermAttendanceReport(
    userId: string,
    classId: string,
    termId?: string,
  ) {
    const scope = await this.resolveClassScope(userId, classId, false);
    return this.getTermAttendanceReportForScope(scope, termId);
  }

  private async getTermAttendanceReportForScope(
    scope: AttendanceScope,
    termId?: string,
  ) {
    const summary = await this.getAttendanceSummaryForScope(
      scope,
      undefined,
      undefined,
      termId,
    );

    const sessionsAsc = await this.prisma.attendanceSession.findMany({
      where: this.buildSessionScopeWhere(scope),
      include: { records: true },
      orderBy: { sessionDate: 'asc' },
    });

    const selectedTerm = termId
      ? summary.terms.find((t: any) => t.id === termId)
      : undefined;

    const filteredSessions =
      selectedTerm?.startDate && selectedTerm?.endDate
        ? sessionsAsc.filter((s) => {
            const t = new Date(s.sessionDate).getTime();
            return (
              t >= new Date(selectedTerm.startDate!).getTime() &&
              t <= new Date(selectedTerm.endDate!).getTime()
            );
          })
        : sessionsAsc;

    const sessionColumns = filteredSessions.map((s) => {
      const dt = new Date(s.sessionDate);
      const dateStr = this.toLocalDateStr(dt);
      const weekdayShort = dt.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = dt.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'short',
      });
      return {
        id: s.id,
        dateStr,
        label: `${weekdayShort} ${dayNum}`,
        presentCount: s.records.filter((r) => r.status === 'PRESENT').length,
        lateCount: s.records.filter((r) => r.status === 'LATE').length,
        excusedCount: s.records.filter((r) => r.status === 'EXCUSED').length,
      };
    });

    const studentRows = summary.roster.map((st, idx) => {
      const byDate: Record<string, string> = {};
      for (const s of filteredSessions) {
        const rec = s.records.find((r) => r.studentId === st.studentId);
        const code =
          rec?.status === 'PRESENT'
            ? 'P'
            : rec?.status === 'LATE'
            ? 'L'
            : rec?.status === 'EXCUSED'
            ? 'E'
            : 'A';
        byDate[s.id] = code;
      }
      return {
        sn: idx + 1,
        ...st,
        byDate,
      };
    });

    const termLabel = selectedTerm?.name || 'All Recorded Days';
    const csvHeader = [
      'S/N',
      'Student Name',
      'ID No',
      'Course / Scope',
      'Class',
      'Period',
      ...sessionColumns.map((c) => this.escapeCsv(c.label)),
      'P',
      'L',
      'E',
      'A',
      'Days',
      'Score',
      'Status',
    ].join(',');

    const csvRows = studentRows.map((st) =>
      [
        st.sn,
        this.escapeCsv(st.fullName),
        this.escapeCsv(st.matricOrAdmissionNo),
        this.escapeCsv(scope.displayCode),
        this.escapeCsv(scope.className),
        this.escapeCsv(termLabel),
        ...sessionColumns.map((c) => st.byDate[c.id] || 'A'),
        st.presentCount,
        st.lateCount,
        st.excusedCount,
        st.absentCount,
        st.totalSessions,
        `${st.attendancePercent}%`,
        st.examEligible ? 'Eligible' : 'Below Cutoff',
      ].join(','),
    );

    const csvText = `\uFEFF${[csvHeader, ...csvRows].join('\r\n')}`;

    return {
      subject: summary.subject,
      termName: selectedTerm?.name || 'All Recorded Days',
      configuredThresholdPercentage: summary.configuredThresholdPercentage,
      totalDaysHeld: filteredSessions.length,
      sessionColumns,
      students: studentRows,
      summaryStats: summary.summaryStats,
      csvText,
    };
  }

  /**
   * 8. GET /attendance/subjects/:subjectId/students/:studentId
   * &  GET /attendance/classes/:classId/students/:studentId
   */
  async getStudentAttendanceDetail(
    userId: string,
    subjectId: string,
    studentId: string,
  ) {
    const scope = await this.resolveSubjectScope(userId, subjectId);
    return this.getStudentAttendanceDetailForScope(scope, studentId);
  }

  async getClassStudentAttendanceDetail(
    userId: string,
    classId: string,
    studentId: string,
  ) {
    const scope = await this.resolveClassScope(userId, classId, false);
    return this.getStudentAttendanceDetailForScope(scope, studentId);
  }

  private async getStudentAttendanceDetailForScope(
    scope: AttendanceScope,
    studentId: string,
  ) {
    const [sessions, studentUser] = await Promise.all([
      this.prisma.attendanceSession.findMany({
        where: this.buildSessionScopeWhere(scope),
        include: {
          records: { where: { studentId } },
        },
        orderBy: { sessionDate: 'desc' },
      }),
      this.prisma.user.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          fullName: true,
          email: true,
          loginId: true,
          studentCode: true,
          studentProfile: {
            select: { matricOrAdmissionNo: true },
          },
        },
      }),
    ]);

    if (!studentUser) {
      throw new NotFoundException('Student not found.');
    }

    const threshold = scope.defaultThreshold;
    let presentCount = 0;
    let lateCount = 0;
    let excusedCount = 0;
    let absentCount = 0;

    const logs = sessions.map((s) => {
      const rec = s.records[0];
      const status = rec?.status ?? ('ABSENT' as AttendanceStatus);
      if (status === 'PRESENT') presentCount += 1;
      else if (status === 'LATE') lateCount += 1;
      else if (status === 'EXCUSED') excusedCount += 1;
      else absentCount += 1;

      const dt = new Date(s.sessionDate);
      return {
        sessionId: s.id,
        sessionDate: s.sessionDate.toISOString(),
        dateStr: this.toLocalDateStr(dt),
        weekday: dt.toLocaleDateString('en-US', { weekday: 'long' }),
        status,
        checkedInAt: rec?.checkedInAt?.toISOString() ?? null,
      };
    });

    const totalSessions = sessions.length;
    const attendedCount = presentCount + lateCount + excusedCount;
    const attendancePercent =
      totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 100;
    const examEligible =
      totalSessions === 0 ? true : attendancePercent >= threshold;

    const studentNo =
      studentUser.studentProfile?.matricOrAdmissionNo ||
      studentUser.loginId ||
      studentUser.studentCode ||
      'N/A';

    const standingLabel = `${attendancePercent}% (${attendedCount}/${totalSessions} days)`;
    const csvLines = [
      'S/N,Student Name,ID No,Class,Scope,Day,Date,Status,Marked Time,Standing',
      ...logs.map((l, idx) =>
        [
          idx + 1,
          this.escapeCsv(studentUser.fullName || 'Student'),
          this.escapeCsv(studentNo),
          this.escapeCsv(scope.className),
          this.escapeCsv(
            scope.mode === 'CLASS'
              ? scope.displayName
              : `${scope.displayCode} - ${scope.displayName}`,
          ),
          this.escapeCsv(l.weekday),
          this.escapeCsv(this.formatCsvDisplayDate(l.sessionDate)),
          l.status,
          this.escapeCsv(this.formatCsvTime(l.checkedInAt)),
          this.escapeCsv(standingLabel),
        ].join(','),
      ),
    ];

    return {
      subject: {
        id: scope.subjectId || scope.classId,
        name: scope.displayName,
        courseCode: scope.displayCode,
        className: scope.className,
      },
      student: {
        studentId: studentUser.id,
        fullName: studentUser.fullName || 'Student',
        matricOrAdmissionNo: studentNo,
        email: studentUser.email,
      },
      summary: {
        presentCount,
        lateCount,
        excusedCount,
        absentCount,
        attendedCount,
        totalSessions,
        attendancePercent,
        minAttendancePercent: threshold,
        examEligible,
      },
      logs,
      csvText: `\uFEFF${csvLines.join('\r\n')}`,
    };
  }
}
