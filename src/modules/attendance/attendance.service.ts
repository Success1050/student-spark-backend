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

/**
 * Day 13: Smart Digital Attendance & Configurable Exam Eligibility Service
 * - Configurable exam eligibility percentage per course/subject (default 75%)
 * - 1-tap Teacher Roll Call logging (PRESENT / LATE / EXCUSED / ABSENT)
 * - 5-minute 4-digit Lecture PIN generator & Student check-in
 * - Automated Multi-Channel Low-Attendance Exam Eligibility Alerts
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Verify subject exists and that a TEACHER user is assigned to it (or its class)
   */
  private async verifySubjectAccess(userId: string, subjectId: string) {
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
        const isFormTeacher = subject.schoolClass.formTeacherId === userId;

        if (!isDirectTeacher && !isAssignedProfile && !isFormTeacher) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to manage attendance for this course.',
          );
        }
      }
    }

    return subject;
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

  /**
   * 1. GET /attendance/subjects/:subjectId/summary
   * Full attendance analytics, active PIN state, session history, weekday register state, and per-student eligibility
   */
  async getSubjectAttendanceSummary(
    subjectId: string,
    overrideThreshold?: number,
    userId?: string,
    targetDate?: string,
    termId?: string,
  ) {
    const subject = await this.verifySubjectAccess(userId || '', subjectId);
    const dayRange = this.parseDayRange(targetDate);

    const configuredThresholdPercentage =
      overrideThreshold !== undefined && !Number.isNaN(overrideThreshold)
        ? Math.min(100, Math.max(10, Number(overrideThreshold)))
        : (subject.minAttendancePercent ??
          subject.school?.defaultMinAttendancePercent ??
          75);

    const [allSessions, students, sessionsMeta] = await Promise.all([
      this.prisma.attendanceSession.findMany({
        where: { subjectId: subject.id },
        include: {
          records: true,
        },
        orderBy: { sessionDate: 'desc' },
      }),
      this.getEnrolledStudentsForClass(subject.schoolId, subject.classId),
      this.prisma.academicSession.findMany({
        where: { schoolId: subject.schoolId },
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
        startDate: t.startDate?.toISOString() ?? null,
        endDate: t.endDate?.toISOString() ?? null,
      })),
    );

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

    // Find active PIN session if any
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

    // Session matching the requested calendar day (Mon-Fri register / specific lecture day)
    const selectedDaySession =
      allSessions.find((s) => {
        const dt = new Date(s.sessionDate);
        return dt >= dayRange.startOfDay && dt <= dayRange.endOfDay;
      }) || null;

    // Build per-student attendance roster
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
      subjectId: subject.id,
      subject: {
        id: subject.id,
        name: subject.name,
        courseCode: subject.courseCode,
        creditUnits: subject.creditUnits,
        classId: subject.classId,
        className: subject.schoolClass.name,
        levelCode: subject.schoolClass.levelCode,
        departmentName: subject.department?.name || 'General',
        minAttendancePercent: configuredThresholdPercentage,
        institutionType: subject.school?.institutionType || 'SECONDARY',
        isTertiary: this.isTertiaryInstitution(subject.school?.institutionType),
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
   * 2. PATCH /attendance/subjects/:subjectId/threshold
   * Update minimum required attendance percentage for exam eligibility
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

    await this.verifySubjectAccess(userId, subjectId);

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

  /**
   * 3. POST /attendance/sessions/pin
   * Generate a 5-minute 4-digit Lecture PIN for classroom student check-in
   */
  async generateLecturePin(
    userId: string,
    payload: {
      subjectId: string;
      durationMinutes?: number;
      sessionId?: string;
    },
  ) {
    if (!payload.subjectId) {
      throw new BadRequestException('subjectId is required.');
    }

    const subject = await this.verifySubjectAccess(userId, payload.subjectId);
    const durationMinutes = Math.min(
      30,
      Math.max(1, Number(payload.durationMinutes || 5)),
    );

    const now = new Date();
    const pinExpiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    // Generate unique 4-digit PIN (1000 - 9999)
    let pinCode = String(Math.floor(1000 + Math.random() * 9000));
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = await this.prisma.attendanceSession.findFirst({
        where: {
          schoolId: subject.schoolId,
          pinCode,
          pinExpiresAt: { gt: now },
        },
      });
      if (!collision) break;
      pinCode = String(Math.floor(1000 + Math.random() * 9000));
    }

    // Reuse today's session if created within last 3 hours or if sessionId is specified
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    let session = payload.sessionId
      ? await this.prisma.attendanceSession.findUnique({
          where: { id: payload.sessionId },
        })
      : await this.prisma.attendanceSession.findFirst({
          where: {
            subjectId: subject.id,
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
          schoolId: subject.schoolId,
          classId: subject.classId,
          subjectId: subject.id,
          teacherId: userId,
          sessionDate: now,
          pinCode,
          pinExpiresAt,
        },
      });
    }

    // Notify enrolled students in the class cohort
    const enrolledStudents = await this.getEnrolledStudentsForClass(
      subject.schoolId,
      subject.classId,
    );

    void Promise.all(
      enrolledStudents.map((st) =>
        this.notificationsService.dispatchNotification({
          userId: st.studentId,
          schoolId: subject.schoolId,
          title: `📍 Lecture Check-In Open: ${subject.courseCode}`,
          body: `Enter 4-digit PIN ${pinCode} within ${durationMinutes} minutes to mark your attendance for ${subject.name}.`,
          category: 'SCHOOL',
          deepLink: '/attendance',
          dataJson: {
            type: 'LECTURE_PIN_OPEN',
            sessionId: session.id,
            subjectId: subject.id,
            courseCode: subject.courseCode,
          },
          channels: { inApp: true, push: true, email: false },
        }),
      ),
    );

    return {
      sessionId: session.id,
      subjectId: subject.id,
      courseCode: subject.courseCode,
      subjectName: subject.name,
      className: subject.schoolClass.name,
      pinCode,
      pinExpiresAt: pinExpiresAt.toISOString(),
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
    };
  }

  /**
   * 4. POST /attendance/sessions/roll-call
   * Teacher 1-tap bulk roll-call logging for an AttendanceSession
   */
  async recordRollCall(
    userId: string,
    payload: {
      subjectId: string;
      sessionId?: string;
      sessionDate?: string;
      startNewSession?: boolean;
      records: RollCallEntryInput[];
    },
  ) {
    if (!payload.subjectId) {
      throw new BadRequestException('subjectId is required.');
    }
    if (!Array.isArray(payload.records) || payload.records.length === 0) {
      throw new BadRequestException(
        'At least one student attendance record is required.',
      );
    }

    const subject = await this.verifySubjectAccess(userId, payload.subjectId);
    const now = new Date();
    const dayRange = this.parseDayRange(payload.sessionDate);
    const isToday = dayRange.isoDate === this.toLocalDateStr(now);

    let session = null;
    if (payload.sessionId) {
      session = await this.prisma.attendanceSession.findUnique({
        where: { id: payload.sessionId },
      });
    } else if (!payload.startNewSession) {
      session = await this.prisma.attendanceSession.findFirst({
        where: {
          subjectId: subject.id,
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
          schoolId: subject.schoolId,
          classId: subject.classId,
          subjectId: subject.id,
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

    const updatedSummary = await this.getSubjectAttendanceSummary(
      subject.id,
      undefined,
      userId,
      dayRange.isoDate,
    );

    // Send low-attendance warning if totalSessions >= 2 and student was marked ABSENT and is below threshold
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
            schoolId: subject.schoolId,
            title: `⚠️ Exam Eligibility Warning: ${subject.courseCode}`,
            body: `Your attendance in ${subject.name} is ${st.attendancePercent}% (${st.attendedCount}/${st.totalSessions} classes), below the ${updatedSummary.configuredThresholdPercentage}% exam requirement.`,
            category: 'SCHOOL',
            deepLink: '/attendance',
            channels: { inApp: true, push: true, email: true },
            emailSubject: `⚠️ Exam Eligibility Alert: ${subject.courseCode} (${subject.name})`,
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
      throw new ForbiddenException(
        `This Lecture PIN belongs to ${session.schoolClass.name} (${session.subject.courseCode}), which is outside your enrolled class cohort.`,
      );
    }

    const now = new Date();
    if (!session.pinExpiresAt || new Date(session.pinExpiresAt) < now) {
      throw new BadRequestException(
        'This Lecture PIN has expired. Please ask your lecturer to regenerate the PIN or mark you via roll call.',
      );
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

    // Calculate student's updated attendance in this subject
    const allSessions = await this.prisma.attendanceSession.findMany({
      where: { subjectId: session.subjectId },
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
    const minAttendancePercent = session.subject.minAttendancePercent ?? 75;
    const examEligible = attendancePercent >= minAttendancePercent;

    return {
      checkedIn: true,
      message: `Checked in to ${session.subject.courseCode} (${session.subject.name})!`,
      record: {
        id: record.id,
        sessionId: session.id,
        status: record.status,
        checkedInAt: record.checkedInAt.toISOString(),
      },
      subject: {
        id: session.subject.id,
        courseCode: session.subject.courseCode,
        name: session.subject.name,
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
        className: null,
        overallAttendancePercent: 100,
        overallExamEligible: true,
        eligibleCoursesCount: 0,
        totalCoursesCount: 0,
        activePinSessions: [],
        subjects: [],
        recentRecords: [],
      };
    }

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

    const subjectBreakdowns = subjects.map((subj) => {
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

        if (!myRecord) {
          absentCount += 1;
        } else if (myRecord.status === 'PRESENT') {
          presentCount += 1;
        } else if (myRecord.status === 'LATE') {
          lateCount += 1;
        } else if (myRecord.status === 'EXCUSED') {
          excusedCount += 1;
        } else {
          absentCount += 1;
        }
      }

      const attendedCount = presentCount + lateCount + excusedCount;
      const minAttendancePercent =
        subj.minAttendancePercent ?? school.defaultMinAttendancePercent ?? 75;
      const attendancePercent =
        totalSessions > 0
          ? Math.round((attendedCount / totalSessions) * 100)
          : 100;
      const examEligible =
        totalSessions === 0 ? true : attendancePercent >= minAttendancePercent;

      // Compute how many consecutive future classes are needed to reach threshold if currently below
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
    const overallAttendancePercent =
      coursesWithSessions.length > 0
        ? Math.round(
            coursesWithSessions.reduce(
              (acc, s) => acc + s.attendancePercent,
              0,
            ) / coursesWithSessions.length,
          )
        : 100;

    const eligibleCoursesCount = subjectBreakdowns.filter(
      (s) => s.examEligible,
    ).length;
    const overallExamEligible =
      eligibleCoursesCount === subjectBreakdowns.length;

    const recentRecordsRaw = await this.prisma.attendanceRecord.findMany({
      where: { studentId },
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
          },
        },
      },
      orderBy: { checkedInAt: 'desc' },
      take: 15,
    });

    const recentRecords = recentRecordsRaw.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      status: r.status,
      checkedInAt: r.checkedInAt.toISOString(),
      sessionDate: r.session.sessionDate.toISOString(),
      subjectId: r.session.subject.id,
      courseCode: r.session.subject.courseCode,
      subjectName: r.session.subject.name,
    }));

    return {
      enrolledInSchool: true,
      schoolName: school.name,
      institutionType: school.institutionType,
      className: schoolClass.name,
      levelCode: schoolClass.levelCode,
      overallAttendancePercent,
      overallExamEligible,
      eligibleCoursesCount,
      totalCoursesCount: subjectBreakdowns.length,
      activePinSessions,
      subjects: subjectBreakdowns,
      recentRecords,
    };
  }

  /**
   * 6. GET /attendance/subjects/:subjectId/sessions/:sessionId/detail
   * Full daily roll-call sheet + downloadable CSV for a single day/session
   */
  async getDailySessionDetail(
    userId: string,
    subjectId: string,
    sessionId: string,
  ) {
    const subject = await this.verifySubjectAccess(userId, subjectId);
    const [session, students] = await Promise.all([
      this.prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        include: { records: true },
      }),
      this.getEnrolledStudentsForClass(subject.schoolId, subject.classId),
    ]);

    if (!session || session.subjectId !== subject.id) {
      throw new NotFoundException('Attendance session not found for this course/subject.');
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
      'S/N,Student Name,ID No,Course,Class,Date,Status,Time / Mode',
      ...rows.map((r) =>
        [
          r.sn,
          this.escapeCsv(r.fullName),
          this.escapeCsv(r.matricOrAdmissionNo),
          this.escapeCsv(subject.courseCode),
          this.escapeCsv(subject.schoolClass.name),
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
        id: subject.id,
        name: subject.name,
        courseCode: subject.courseCode,
        className: subject.schoolClass.name,
        schoolName: subject.school?.name || 'School',
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
   * 7. GET /attendance/subjects/:subjectId/report
   * Full Term / Session Register Matrix + CSV export across all recorded dates
   */
  async getTermAttendanceReport(
    userId: string,
    subjectId: string,
    termId?: string,
  ) {
    const summary = await this.getSubjectAttendanceSummary(
      subjectId,
      undefined,
      userId,
      undefined,
      termId,
    );

    const sessionsAsc = await this.prisma.attendanceSession.findMany({
      where: { subjectId },
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
      'Course',
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
        this.escapeCsv(summary.subject.courseCode),
        this.escapeCsv(summary.subject.className),
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
   * Particular student's attendance breakdown & chronological Mon-Fri history + CSV export
   */
  async getStudentAttendanceDetail(
    userId: string,
    subjectId: string,
    studentId: string,
  ) {
    const subject = await this.verifySubjectAccess(userId, subjectId);
    const [sessions, studentUser] = await Promise.all([
      this.prisma.attendanceSession.findMany({
        where: { subjectId: subject.id },
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

    const threshold =
      subject.minAttendancePercent ??
      subject.school?.defaultMinAttendancePercent ??
      75;

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
      'S/N,Student Name,ID No,Class,Course,Day,Date,Status,Marked Time,Standing',
      ...logs.map((l, idx) =>
        [
          idx + 1,
          this.escapeCsv(studentUser.fullName || 'Student'),
          this.escapeCsv(studentNo),
          this.escapeCsv(subject.schoolClass.name),
          this.escapeCsv(`${subject.courseCode} - ${subject.name}`),
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
        id: subject.id,
        name: subject.name,
        courseCode: subject.courseCode,
        className: subject.schoolClass.name,
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
