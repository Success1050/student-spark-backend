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

    const teacherProfile = await this.prisma.teacherProfile.findFirst({
      where: { userId: user.id || user.sub },
      include: {
        assignedClasses: { select: { id: true } },
        assignedSubjects: { select: { id: true } },
      },
    });

    if (!teacherProfile) {
      // Fallback: check legacy direct teacherId on subject or class formTeacherId
      const legacySubject = subjectId
        ? await this.prisma.schoolSubject.findFirst({
            where: { id: subjectId, teacherId: user.id || user.sub },
          })
        : null;

      const legacyClass = classId
        ? await this.prisma.schoolClass.findFirst({
            where: { id: classId, formTeacherId: user.id || user.sub },
          })
        : null;

      if (!legacySubject && !legacyClass) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this course, subject, or class cohort.',
        );
      }
      return true;
    }

    // Check class assignment
    if (classId) {
      const isClassAssigned =
        teacherProfile.assignedClasses.some((c: any) => c.id === classId);
      if (!isClassAssigned) {
        // Also check if teacher has any subject in that class
        const hasSubjectInClass = await this.prisma.schoolSubject.findFirst({
          where: {
            classId,
            OR: [
              { teacherId: user.id || user.sub },
              { assignedTeachers: { some: { id: teacherProfile.id } } },
            ],
          },
        });

        if (!hasSubjectInClass) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to this class or level cohort.',
          );
        }
      }
    }

    // Check subject/course assignment
    if (subjectId) {
      const isSubjectAssigned =
        teacherProfile.assignedSubjects.some((s: any) => s.id === subjectId);
      if (!isSubjectAssigned) {
        const isLegacySubject = await this.prisma.schoolSubject.findFirst({
          where: { id: subjectId, teacherId: user.id || user.sub },
        });

        if (!isLegacySubject) {
          throw new ForbiddenException(
            'Access denied: You are not assigned to this course or subject.',
          );
        }
      }
    }

    return true;
  }
}
