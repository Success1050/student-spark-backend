import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * TeacherClassScopeGuard:
 * Strict isolation guard ensuring a Teacher/Lecturer can only access, grade,
 * roll-call, or upload materials for Courses, Subjects, and Classes assigned to them.
 * School Admins and SuperAdmins bypass this scope check.
 */
@Injectable()
export class TeacherClassScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return true;

    // SuperAdmin and SchoolAdmin have institution-wide oversight
    if (user.role === 'SUPER_ADMIN' || user.role === 'SCHOOL_ADMIN') {
      return true;
    }

    // Only teachers are subject to class/subject scoping
    if (user.role !== 'TEACHER') {
      return true;
    }

    const classId =
      request.params?.classId ||
      request.body?.classId ||
      request.query?.classId;

    const subjectId =
      request.params?.subjectId ||
      request.body?.subjectId ||
      request.query?.subjectId;

    // If neither classId nor subjectId is requested, allow request
    if (!classId && !subjectId) {
      return true;
    }

    const userId = user.id || user.sub;
    const teacherProfile = await this.prisma.teacherProfile.findFirst({
      where: { userId },
      include: {
        assignedClasses: { select: { id: true } },
        assignedSubjects: { select: { id: true } },
      },
    });

    if (!teacherProfile) {
      // Fallback: check legacy direct teacherId on subject or class formTeacherId
      const legacySubject = subjectId
        ? await this.prisma.schoolSubject.findFirst({
            where: { id: subjectId, teacherId: userId },
          })
        : null;

      const legacyClass = classId
        ? await this.prisma.schoolClass.findFirst({
            where: { id: classId, formTeacherId: userId },
          })
        : null;

      if (!legacySubject && !legacyClass) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this course, subject, or class cohort.',
        );
      }
      return true;
    }

    const assignedClassIds = teacherProfile.assignedClasses.map((c: any) => c.id);

    // Check class assignment (direct assignment, form teacher, or teaching any subject in class)
    if (classId) {
      const isClassAssigned = assignedClassIds.includes(classId);
      if (!isClassAssigned) {
        const hasClassAccess = await this.prisma.schoolClass.findFirst({
          where: {
            id: classId,
            OR: [
              { formTeacherId: userId },
              {
                subjects: {
                  some: {
                    OR: [
                      { teacherId: userId },
                      { assignedTeachers: { some: { id: teacherProfile.id } } },
                    ],
                  },
                },
              },
            ],
          },
          select: { id: true },
        });

        if (!hasClassAccess) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to this class or level cohort.',
          );
        }
      }
    }

    // Check subject/course assignment (explicit subject, legacy owner, or handlesAllSubjects in an assigned class)
    if (subjectId) {
      const isSubjectAssigned =
        teacherProfile.assignedSubjects.some((s: any) => s.id === subjectId);
      if (!isSubjectAssigned) {
        const subjectRecord = await this.prisma.schoolSubject.findUnique({
          where: { id: subjectId },
          select: { id: true, classId: true, teacherId: true },
        });

        const isLegacySubject = subjectRecord?.teacherId === userId;
        const isAllSubjectsClassTeacher =
          Boolean(teacherProfile.handlesAllSubjects) &&
          Boolean(subjectRecord?.classId) &&
          assignedClassIds.includes(subjectRecord!.classId);

        if (!isLegacySubject && !isAllSubjectsClassTeacher) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to this course or subject.',
          );
        }
      }
    }

    return true;
  }
}
