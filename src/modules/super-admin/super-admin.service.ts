import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Web-Based SuperAdmin Portal Service (exclusively for the Platform Owner)
 * Provides global revenue metrics, school tenant management, marketplace moderation,
 * withdrawal payout approvals, and cross-school unique ID search.
 */
@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobalOverview() {
    void this.prisma;
    return {
      totalSchools: 0,
      totalStudents: 0,
      totalSubscriptionRevenueKobo: 0,
      totalMarketplaceCommissionKobo: 0,
      pendingWithdrawalsCount: 0,
    };
  }

  async searchGlobalDirectory(query?: string, role?: string) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      return { query: '', teachers: [], students: [], totalMatches: 0 };
    }

    const normalizedRole = String(role || '').toUpperCase().trim();
    const includeTeachers = !normalizedRole || normalizedRole === 'TEACHER';
    const includeStudents = !normalizedRole || normalizedRole === 'STUDENT';

    const [teachers, students] = await Promise.all([
      includeTeachers
        ? this.prisma.teacherProfile.findMany({
            where: {
              OR: [
                { staffId: { contains: cleanQuery, mode: 'insensitive' } },
                { user: { loginId: { contains: cleanQuery, mode: 'insensitive' } } },
                { user: { fullName: { contains: cleanQuery, mode: 'insensitive' } } },
                { user: { email: { contains: cleanQuery, mode: 'insensitive' } } },
              ],
            },
            take: 30,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
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
                },
              },
              department: { select: { id: true, name: true, code: true } },
            },
          })
        : Promise.resolve([]),
      includeStudents
        ? this.prisma.studentProfile.findMany({
            where: {
              OR: [
                {
                  matricOrAdmissionNo: {
                    contains: cleanQuery,
                    mode: 'insensitive',
                  },
                },
                { user: { loginId: { contains: cleanQuery, mode: 'insensitive' } } },
                { user: { fullName: { contains: cleanQuery, mode: 'insensitive' } } },
                { user: { email: { contains: cleanQuery, mode: 'insensitive' } } },
              ],
            },
            take: 30,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
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
                },
              },
              department: { select: { id: true, name: true, code: true } },
              schoolClass: { select: { id: true, name: true, levelCode: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      query: cleanQuery,
      teachers: teachers.map((t) => ({
        id: t.id,
        role: 'TEACHER' as const,
        uniqueId: t.staffId || t.user.loginId || 'N/A',
        fullName: t.user.fullName,
        email: t.user.email,
        title: t.title,
        educationLevel: t.educationLevel,
        school: t.school,
        department: t.department,
        createdAt: t.createdAt,
      })),
      students: students.map((s) => ({
        id: s.id,
        role: 'STUDENT' as const,
        uniqueId: s.matricOrAdmissionNo || s.user.loginId || 'N/A',
        fullName: s.user.fullName,
        email: s.user.email,
        level: s.level,
        school: s.school,
        department: s.department,
        schoolClass: s.schoolClass,
        createdAt: s.createdAt,
      })),
      totalMatches: teachers.length + students.length,
    };
  }
}
