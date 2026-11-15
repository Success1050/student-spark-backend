import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MarketplaceItemStatus, MarketplaceVisibilityScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class CourseRepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  private async resolveActorContext(actorId: string) {
    if (!actorId) throw new BadRequestException('Authenticated user ID required');

    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      include: {
        school: true,
        studentProfile: {
          include: { department: true, schoolClass: true },
        },
        teacherProfile: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const activeAssignments = await this.prisma.courseRepAssignment.findMany({
      where: {
        studentId: actorId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        schoolClass: { select: { id: true, name: true, levelCode: true, departmentId: true } },
        subject: { select: { id: true, name: true, courseCode: true } },
        department: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const roleUpper = String(user.role).toUpperCase();
    const isStaff =
      roleUpper === 'SCHOOL_ADMIN' ||
      roleUpper === 'SUPER_ADMIN' ||
      roleUpper === 'TEACHER';

    return {
      user,
      roleUpper,
      isStaff,
      activeAssignments,
    };
  }

  private assertRepOrStaffPermission(
    ctx: Awaited<ReturnType<CourseRepService['resolveActorContext']>>,
    classId: string,
    permission: 'canBroadcastVenue' | 'canDistributeSlides' | 'canGenerateAttendanceSlips',
  ) {
    if (ctx.isStaff) return;
    const match = ctx.activeAssignments.find(
      (a) => a.classId === classId && Boolean(a[permission]),
    );
    if (!match) {
      throw new ForbiddenException(
        'You do not have active Course Rep delegation permissions for this cohort/course.',
      );
    }
  }

  /**
   * 1. Delegate Course Rep role to a student (SCHOOL_ADMIN, TEACHER, SUPER_ADMIN)
   */
  async assignCourseRep(
    actorId: string,
    dto: {
      studentId: string;
      classId?: string;
      subjectId?: string;
      title?: string;
      canBroadcastVenue?: boolean;
      canDistributeSlides?: boolean;
      canGenerateAttendanceSlips?: boolean;
      expiresAt?: string;
    },
  ) {
    const actor = await this.resolveActorContext(actorId);
    if (!actor.isStaff) {
      throw new ForbiddenException('Only School Admins or Lecturers/Teachers can delegate Course Reps.');
    }

    if (!dto.studentId) {
      throw new BadRequestException('studentId is required.');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: dto.studentId },
      include: { studentProfile: true },
    });
    if (!student || !student.schoolId) {
      throw new NotFoundException('Target student not found inside an institution.');
    }
    if (actor.user.schoolId && student.schoolId !== actor.user.schoolId && actor.roleUpper !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot delegate a Course Rep outside your institution.');
    }

    const resolvedClassId =
      dto.classId || student.studentProfile?.classId || student.classId;
    if (!resolvedClassId) {
      throw new BadRequestException('Student does not belong to a class/level cohort yet.');
    }

    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: resolvedClassId },
    });
    if (!schoolClass) {
      throw new NotFoundException('Target class/level cohort not found.');
    }

    const resolvedSubjectId = dto.subjectId?.trim() || null;

    const existing = await this.prisma.courseRepAssignment.findFirst({
      where: {
        schoolId: student.schoolId,
        classId: resolvedClassId,
        subjectId: resolvedSubjectId,
        studentId: student.id,
      },
    });

    const assignmentData = {
      departmentId: schoolClass.departmentId || student.studentProfile?.departmentId || null,
      delegatedById: actorId,
      title:
        dto.title?.trim() ||
        `${schoolClass.name} Course Representative`,
      canBroadcastVenue: dto.canBroadcastVenue ?? true,
      canDistributeSlides: dto.canDistributeSlides ?? true,
      canGenerateAttendanceSlips: dto.canGenerateAttendanceSlips ?? true,
      isActive: true,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    };

    const assignment = existing
      ? await this.prisma.courseRepAssignment.update({
          where: { id: existing.id },
          data: assignmentData,
          include: {
            student: { select: { id: true, fullName: true, email: true } },
            schoolClass: { select: { id: true, name: true, levelCode: true } },
            subject: { select: { id: true, name: true, courseCode: true } },
          },
        })
      : await this.prisma.courseRepAssignment.create({
          data: {
            schoolId: student.schoolId,
            classId: resolvedClassId,
            subjectId: resolvedSubjectId,
            studentId: student.id,
            ...assignmentData,
          },
          include: {
            student: { select: { id: true, fullName: true, email: true } },
            schoolClass: { select: { id: true, name: true, levelCode: true } },
            subject: { select: { id: true, name: true, courseCode: true } },
          },
        });

    if (student.studentProfile) {
      await this.prisma.studentProfile.update({
        where: { id: student.studentProfile.id },
        data: { isCourseRep: true },
      });
    }

    void this.notifications.dispatchNotification({
      userId: student.id,
      schoolId: student.schoolId,
      title: '🎖️ Course Rep Delegation Granted',
      body: `${actor.user.fullName || 'Your Lecturer/Admin'} appointed you as ${assignment.title} for ${schoolClass.name}. Open the Course Rep Command Hub to coordinate your class.`,
      category: 'SCHOOL',
      deepLink: '/courseRep',
      channels: { inApp: true, push: true, email: false },
    });

    return {
      success: true,
      assignment,
    };
  }

  /**
   * 2. Revoke a Course Rep assignment
   */
  async revokeCourseRep(actorId: string, assignmentId: string) {
    const actor = await this.resolveActorContext(actorId);
    if (!actor.isStaff) {
      throw new ForbiddenException('Only School Admins or Lecturers/Teachers can revoke Course Rep access.');
    }

    const assignment = await this.prisma.courseRepAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Course Rep assignment not found.');
    }
    if (actor.user.schoolId && assignment.schoolId !== actor.user.schoolId && actor.roleUpper !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot revoke a Course Rep in another institution.');
    }

    await this.prisma.courseRepAssignment.update({
      where: { id: assignmentId },
      data: { isActive: false },
    });

    const remainingActive = await this.prisma.courseRepAssignment.count({
      where: {
        studentId: assignment.studentId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    if (remainingActive === 0) {
      await this.prisma.studentProfile.updateMany({
        where: { userId: assignment.studentId },
        data: { isCourseRep: false },
      });
    }

    return { success: true, assignmentId };
  }

  /**
   * 3. List Course Rep delegates & eligible students for Teachers/Admins
   */
  async listDelegates(actorId: string, classId?: string) {
    const actor = await this.resolveActorContext(actorId);
    const schoolId = actor.user.schoolId;
    if (!schoolId) return { delegates: [], classes: [] };

    const assignments = await this.prisma.courseRepAssignment.findMany({
      where: {
        schoolId,
        isActive: true,
        ...(classId ? { classId } : {}),
      },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            studentProfile: { select: { matricOrAdmissionNo: true, level: true } },
          },
        },
        schoolClass: { select: { id: true, name: true, levelCode: true } },
        subject: { select: { id: true, name: true, courseCode: true } },
        delegatedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const classes = await this.prisma.schoolClass.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        levelCode: true,
        subjects: { select: { id: true, name: true, courseCode: true } },
        studentProfiles: {
          select: {
            userId: true,
            matricOrAdmissionNo: true,
            isCourseRep: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      delegates: assignments,
      classes,
    };
  }

  /**
   * 4. Course Rep Command Hub Dashboard
   */
  async getDashboard(userId: string) {
    const ctx = await this.resolveActorContext(userId);
    const schoolId = ctx.user.schoolId;
    const studentClassId = ctx.user.studentProfile?.classId || ctx.user.classId;

    if (!schoolId) {
      return {
        isAuthorizedRep: false,
        isStaff: ctx.isStaff,
        assignments: [],
        availableClasses: [],
        broadcasts: [],
        slips: [],
        continuityMode: 'ACTIVE',
      };
    }

    const assignedClassIds = Array.from(
      new Set([
        ...ctx.activeAssignments.map((a) => a.classId),
        ...(studentClassId ? [studentClassId] : []),
      ]),
    );

    const availableClasses = ctx.isStaff
      ? await this.prisma.schoolClass.findMany({
          where: { schoolId },
          include: { subjects: { select: { id: true, name: true, courseCode: true } } },
          orderBy: { name: 'asc' },
        })
      : await this.prisma.schoolClass.findMany({
          where: { id: { in: ctx.activeAssignments.map((a) => a.classId) } },
          include: { subjects: { select: { id: true, name: true, courseCode: true } } },
          orderBy: { name: 'asc' },
        });

    const targetBroadcastClassIds = ctx.isStaff
      ? availableClasses.map((c) => c.id)
      : assignedClassIds;

    const broadcasts = targetBroadcastClassIds.length
      ? await this.prisma.courseRepBroadcast.findMany({
          where: {
            schoolId,
            classId: { in: targetBroadcastClassIds },
          },
          include: {
            sender: { select: { id: true, fullName: true } },
            schoolClass: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true, courseCode: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : [];

    const slips = targetBroadcastClassIds.length
      ? await this.prisma.courseRepAttendanceSlip.findMany({
          where: {
            schoolId,
            classId: { in: targetBroadcastClassIds },
          },
          include: {
            createdBy: { select: { id: true, fullName: true } },
            schoolClass: { select: { id: true, name: true } },
            entries: {
              select: { id: true, studentId: true, studentName: true, matricNo: true, signedAt: true },
              orderBy: { signedAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];

    return {
      isAuthorizedRep: ctx.isStaff || ctx.activeAssignments.length > 0,
      isStaff: ctx.isStaff,
      schoolName: ctx.user.school?.name || null,
      continuityMode: ctx.user.school?.academicContinuityMode || 'ACTIVE',
      strikeNoticeTitle: ctx.user.school?.strikeNoticeTitle || null,
      strikeNoticeBody: ctx.user.school?.strikeNoticeBody || null,
      assignments: ctx.activeAssignments,
      availableClasses,
      broadcasts,
      slips: slips.map((s) => ({
        ...s,
        signedCount: s.entries.length,
        alreadySignedByMe: s.entries.some((e) => e.studentId === userId),
        entries:
          ctx.isStaff ||
          ctx.activeAssignments.some((a) => a.classId === s.classId)
            ? s.entries
            : [],
      })),
    };
  }

  /**
   * 5. Broadcast venue/time change to class & lecturer
   */
  async createBroadcast(
    userId: string,
    dto: {
      classId: string;
      subjectId?: string;
      title: string;
      message: string;
      venue?: string;
      scheduledTime?: string;
      urgency?: 'NORMAL' | 'URGENT' | 'CANCELLED';
    },
  ) {
    const ctx = await this.resolveActorContext(userId);
    if (!dto.classId || !dto.title?.trim() || !dto.message?.trim()) {
      throw new BadRequestException('classId, title, and message are required.');
    }

    this.assertRepOrStaffPermission(ctx, dto.classId, 'canBroadcastVenue');

    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: dto.classId },
    });
    if (!schoolClass) throw new NotFoundException('Class/level not found');

    const broadcast = await this.prisma.courseRepBroadcast.create({
      data: {
        schoolId: schoolClass.schoolId,
        classId: dto.classId,
        subjectId: dto.subjectId || null,
        senderId: userId,
        title: dto.title.trim(),
        message: dto.message.trim(),
        venue: dto.venue?.trim() || null,
        scheduledTime: dto.scheduledTime?.trim() || null,
        urgency: dto.urgency || 'NORMAL',
      },
      include: {
        sender: { select: { id: true, fullName: true } },
        schoolClass: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true, courseCode: true } },
      },
    });

    const classStudents = await this.prisma.studentProfile.findMany({
      where: { classId: dto.classId },
      select: { userId: true },
    });

    const isUrgent = broadcast.urgency === 'URGENT' || broadcast.urgency === 'CANCELLED';
    const metaLine = [
      broadcast.venue ? `Venue: ${broadcast.venue}` : '',
      broadcast.scheduledTime ? `Time: ${broadcast.scheduledTime}` : '',
    ]
      .filter(Boolean)
      .join(' • ');

    for (const s of classStudents) {
      if (s.userId === userId) continue;
      void this.notifications.dispatchNotification({
        userId: s.userId,
        schoolId: schoolClass.schoolId,
        title: `${isUrgent ? '🚨' : '📢'} ${broadcast.title}`,
        body: `${broadcast.message}${metaLine ? ` (${metaLine})` : ''} — Sent by ${ctx.user.fullName || 'Course Rep'}`,
        category: 'SCHOOL',
        deepLink: '/courseRep',
        channels: { inApp: true, push: true, email: isUrgent },
      });
    }

    return broadcast;
  }

  /**
   * 6. Distribute Lecture Slides / Handout (mirrors cleanly to Note + Class Handouts shelf)
   */
  async distributeLectureSlide(
    userId: string,
    dto: {
      classId: string;
      subjectId?: string;
      courseCode?: string;
      title: string;
      description?: string;
      fileBase64?: string;
      fileName?: string;
      fileUrl?: string;
      fileSize?: number;
    },
  ) {
    const ctx = await this.resolveActorContext(userId);
    if (!dto.classId || !dto.title?.trim() || (!dto.fileBase64 && !dto.fileUrl && !dto.description?.trim())) {
      throw new BadRequestException('classId, title, and a slide file or description are required.');
    }

    this.assertRepOrStaffPermission(ctx, dto.classId, 'canDistributeSlides');

    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: dto.classId },
      include: { department: true, school: true },
    });
    if (!schoolClass) throw new NotFoundException('Class/level cohort not found');

    const subject = dto.subjectId
      ? await this.prisma.schoolSubject.findUnique({ where: { id: dto.subjectId } })
      : null;

    let resolvedFileUrl: string | null = dto.fileUrl?.trim() || null;
    if (dto.fileBase64) {
      const cleanBase64 = dto.fileBase64.includes('base64,')
        ? dto.fileBase64.split('base64,')[1]
        : dto.fileBase64;
      const buf = Buffer.from(cleanBase64, 'base64');
      if (!buf.byteLength) throw new BadRequestException('Uploaded slide file appears empty.');
      const safeOriginal = (dto.fileName || dto.title || 'slides.pdf').replace(
        /[^a-zA-Z0-9._-]/g,
        '_',
      );
      const uploaded = await this.storage.uploadPdfBuffer(
        buf,
        `${randomUUID().slice(0, 8)}_${safeOriginal}`,
        'notes',
      );
      resolvedFileUrl = uploaded.publicUrl;
    }

    const courseCode = subject?.courseCode || dto.courseCode?.trim().toUpperCase() || schoolClass.name;
    const summaryText =
      dto.description?.trim() ||
      `Attached File: ${dto.fileName || dto.title.trim()}`;

    const note = await this.prisma.note.create({
      data: {
        userId,
        schoolId: schoolClass.schoolId,
        classId: schoolClass.id,
        subjectId: subject?.id || null,
        title: dto.title.trim(),
        summary: summaryText,
        courseCode,
        color: '#0891b2',
        listsOfTopic: [],
        fileUrl: resolvedFileUrl,
        isClassNote: true,
      },
    });

    const mirroredItem = await this.prisma.marketplaceItem.create({
      data: {
        sellerId: userId,
        schoolId: schoolClass.schoolId,
        classId: schoolClass.id,
        subjectId: subject?.id || null,
        title: dto.title.trim(),
        description: summaryText,
        authorName: `${ctx.user.fullName || 'Course Rep'} (Course Rep)`,
        courseCode,
        institutionType: schoolClass.school?.institutionType || 'UNIVERSITY',
        priceKobo: 0,
        isFree: true,
        encryptedFileUrl: resolvedFileUrl || `class-note://${note.id}`,
        status: MarketplaceItemStatus.APPROVED,
        visibilityScope: MarketplaceVisibilityScope.COURSE_OR_CLASS,
        materialType: 'LECTURE_SLIDE',
        format: dto.fileName?.toLowerCase().endsWith('.ppt') || dto.fileName?.toLowerCase().endsWith('.pptx')
          ? 'SLIDES'
          : 'PDF',
        fileSize: dto.fileSize || null,
        pageCount: 1,
        departmentName: schoolClass.department?.name || null,
        levelName: schoolClass.levelCode || null,
      },
    });

    const classStudents = await this.prisma.studentProfile.findMany({
      where: { classId: schoolClass.id },
      select: { userId: true },
    });

    for (const s of classStudents) {
      if (s.userId === userId) continue;
      void this.notifications.dispatchNotification({
        userId: s.userId,
        schoolId: schoolClass.schoolId,
        title: `📑 New Lecture Slides: ${mirroredItem.title}`,
        body: `Shared by Course Rep ${ctx.user.fullName || ''} for ${courseCode}.`,
        category: 'SCHOOL',
        deepLink: `/ebookReader?bookId=${mirroredItem.id}`,
        channels: { inApp: true, push: true, email: false },
      });
    }

    return {
      success: true,
      note,
      marketplaceItem: mirroredItem,
    };
  }

  /**
   * 7. Generate Instant Lecture Attendance Slip (linked with AttendanceSession & 4-digit PIN)
   */
  async generateAttendanceSlip(
    userId: string,
    dto: {
      classId: string;
      subjectId?: string;
      courseCode?: string;
      courseTitle?: string;
      venue?: string;
      validMinutes?: number;
    },
  ) {
    const ctx = await this.resolveActorContext(userId);
    if (!dto.classId) throw new BadRequestException('classId is required.');

    this.assertRepOrStaffPermission(ctx, dto.classId, 'canGenerateAttendanceSlips');

    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: dto.classId },
    });
    if (!schoolClass) throw new NotFoundException('Class/level not found');

    const subject = dto.subjectId
      ? await this.prisma.schoolSubject.findUnique({ where: { id: dto.subjectId } })
      : null;

    const validMinutes = Math.min(240, Math.max(5, Number(dto.validMinutes) || 45));
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);
    const slipCode = `SLIP-${Math.floor(1000 + Math.random() * 9000)}`;
    const pinCode = String(Math.floor(1000 + Math.random() * 9000));

    // Create linked AttendanceSession so signing this slip counts toward real Attendance Standing!
    const attendanceSession = await this.prisma.attendanceSession.create({
      data: {
        schoolId: schoolClass.schoolId,
        classId: schoolClass.id,
        subjectId: subject?.id || null,
        teacherId: subject?.teacherId || userId,
        sessionDate: new Date(),
        pinCode,
        pinExpiresAt: expiresAt,
      },
    });

    const courseCode = subject?.courseCode || dto.courseCode?.trim().toUpperCase() || schoolClass.name;
    const courseTitle = subject?.name || dto.courseTitle?.trim() || `${schoolClass.name} Lecture`;

    const slip = await this.prisma.courseRepAttendanceSlip.create({
      data: {
        schoolId: schoolClass.schoolId,
        classId: schoolClass.id,
        subjectId: subject?.id || null,
        createdById: userId,
        courseCode,
        courseTitle,
        venue: dto.venue?.trim() || null,
        slipCode,
        linkedSessionId: attendanceSession.id,
        expiresAt,
        isActive: true,
      },
      include: {
        schoolClass: { select: { id: true, name: true } },
      },
    });

    const classStudents = await this.prisma.studentProfile.findMany({
      where: { classId: schoolClass.id },
      select: { userId: true },
    });

    for (const s of classStudents) {
      if (s.userId === userId) continue;
      void this.notifications.dispatchNotification({
        userId: s.userId,
        schoolId: schoolClass.schoolId,
        title: `📝 Attendance Slip Open: ${courseCode}`,
        body: `Enter slip code ${slip.slipCode} (or PIN ${pinCode})${slip.venue ? ` at ${slip.venue}` : ''}. Valid for ${validMinutes} mins.`,
        category: 'SCHOOL',
        deepLink: '/courseRep',
        channels: { inApp: true, push: true, email: false },
      });
    }

    return {
      ...slip,
      linkedPinCode: pinCode,
      signedCount: 0,
    };
  }

  /**
   * 8. Student signs an active Lecture Attendance Slip by slipCode
   */
  async signAttendanceSlip(userId: string, slipCode: string) {
    const cleanCode = slipCode?.trim().toUpperCase();
    if (!cleanCode) throw new BadRequestException('Attendance slip code is required.');

    const slip = await this.prisma.courseRepAttendanceSlip.findUnique({
      where: { slipCode: cleanCode },
    });
    if (!slip || !slip.isActive) {
      throw new NotFoundException(`Attendance slip "${cleanCode}" was not found or has closed.`);
    }
    if (slip.expiresAt < new Date()) {
      throw new BadRequestException('This lecture attendance slip has expired.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: true },
    });
    if (!user) throw new NotFoundException('Student not found.');

    const studentClassId = user.studentProfile?.classId || user.classId;
    if (studentClassId && studentClassId !== slip.classId) {
      throw new ForbiddenException('You are not enrolled in this lecture cohort.');
    }

    const entry = await this.prisma.courseRepAttendanceSlipEntry.upsert({
      where: {
        slipId_studentId: { slipId: slip.id, studentId: userId },
      },
      update: { signedAt: new Date() },
      create: {
        slipId: slip.id,
        studentId: userId,
        matricNo: user.studentProfile?.matricOrAdmissionNo || user.loginId || user.studentCode || null,
        studentName: user.fullName || user.username || user.email.split('@')[0],
      },
    });

    if (slip.linkedSessionId) {
      await this.prisma.attendanceRecord.upsert({
        where: {
          sessionId_studentId: {
            sessionId: slip.linkedSessionId,
            studentId: userId,
          },
        },
        update: { status: 'PRESENT', checkedInAt: new Date() },
        create: {
          sessionId: slip.linkedSessionId,
          studentId: userId,
          status: 'PRESENT',
          checkedInAt: new Date(),
        },
      });
    }

    return {
      success: true,
      message: `Signed ${slip.courseCode} lecture slip (${slip.slipCode})!`,
      receipt: {
        slipCode: slip.slipCode,
        courseCode: slip.courseCode,
        courseTitle: slip.courseTitle,
        venue: slip.venue,
        matricNo: entry.matricNo,
        studentName: entry.studentName,
        signedAt: entry.signedAt.toISOString(),
      },
    };
  }
}
