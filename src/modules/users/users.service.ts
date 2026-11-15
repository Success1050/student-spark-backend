import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Replaces Supabase 'profiles' and 'subjects' (personal courses) and streak queries
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        school: true,
        schoolClass: true,
        studentProfile: true,
        courseRepAssignments: {
          where: { isActive: true },
          include: {
            schoolClass: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true, courseCode: true } },
            department: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const isCourseRep = Boolean(
      user.studentProfile?.isCourseRep ||
        (user.courseRepAssignments && user.courseRepAssignments.length > 0),
    );

    return {
      ...user,
      user_id: user.id,
      full_name: user.fullName || user.username || user.email.split('@')[0],
      username: user.username || user.fullName || user.email.split('@')[0],
      avatar_url: user.avatarUrl,
      current_streak: user.streak,
      longest_streak: user.longestStreak,
      last_study_date: user.lastCompletedDate,
      referral_code: user.referralCode,
      school_id: user.schoolId,
      class_id: user.classId,
      subscription_start: user.subscriptionStart,
      subscription_end: user.subscriptionEnd,
      isCourseRep,
      is_course_rep: isCourseRep,
      institutionType: user.school?.institutionType || null,
      academicContinuityMode: user.school?.academicContinuityMode || 'ACTIVE',
      strikeNoticeTitle: user.school?.strikeNoticeTitle || null,
      strikeNoticeBody: user.school?.strikeNoticeBody || null,
    };
  }

  async updateProfile(userId: string, data: Record<string, unknown>) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(typeof data.fullName === 'string' ? { fullName: data.fullName } : {}),
        ...(typeof data.full_name === 'string' ? { fullName: data.full_name } : {}),
        ...(typeof data.username === 'string' ? { username: data.username } : {}),
        ...(typeof data.avatarUrl === 'string' ? { avatarUrl: data.avatarUrl } : {}),
        ...(typeof data.avatar_url === 'string' ? { avatarUrl: data.avatar_url } : {}),
        ...(typeof data.motivation === 'string' ? { motivation: data.motivation } : {}),
        ...(typeof data.notifyInApp === 'boolean' ? { notifyInApp: data.notifyInApp } : {}),
        ...(typeof data.notifyPush === 'boolean' ? { notifyPush: data.notifyPush } : {}),
        ...(typeof data.notifyEmail === 'boolean' ? { notifyEmail: data.notifyEmail } : {}),
      },
    });
    return this.getProfile(updated.id);
  }

  async getStreak(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { streak: true, longestStreak: true, lastCompletedDate: true },
    });

    if (!user) {
      return { current_streak: 0, longest_streak: 0 };
    }

    const today = new Date().toISOString().split('T')[0];
    const lastStudyDate = user.lastCompletedDate;

    if (lastStudyDate) {
      const lastDate = new Date(lastStudyDate);
      const todayDate = new Date(today);
      const diffDays = Math.floor(
        (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays > 1) {
        return {
          current_streak: 0,
          longest_streak: user.longestStreak || 0,
        };
      }
    }

    return {
      current_streak: user.streak || 0,
      longest_streak: user.longestStreak || 0,
    };
  }

  async updateStreak(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { streak: true, longestStreak: true, lastCompletedDate: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const today = new Date().toISOString().split('T')[0];
    const lastStudyDate = user.lastCompletedDate;

    let newCurrentStreak = user.streak || 0;
    let newLongestStreak = user.longestStreak || 0;

    if (!lastStudyDate) {
      newCurrentStreak = 1;
      newLongestStreak = Math.max(1, newLongestStreak);
    } else {
      const lastDate = new Date(lastStudyDate);
      const todayDate = new Date(today);
      const diffDays = Math.floor(
        (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays === 0) {
        return {
          current_streak: newCurrentStreak,
          longest_streak: newLongestStreak,
        };
      } else if (diffDays === 1) {
        newCurrentStreak += 1;
        if (newCurrentStreak > newLongestStreak) {
          newLongestStreak = newCurrentStreak;
        }
      } else {
        newCurrentStreak = 1;
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        streak: newCurrentStreak,
        longestStreak: newLongestStreak,
        lastCompletedDate: today,
      },
    });

    return {
      current_streak: newCurrentStreak,
      longest_streak: newLongestStreak,
    };
  }

  async getUserCourses(userId: string) {
    const courses = await this.prisma.userCourse.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map((c) => ({
      id: c.id,
      user_id: c.userId,
      course_code: c.courseCode,
      color: c.color,
    }));
  }

  async addUserCourse(userId: string, courseCode: string, color: string) {
    const created = await this.prisma.userCourse.create({
      data: {
        userId,
        courseCode,
        color: color || '#6366F1',
      },
    });

    return [
      {
        id: created.id,
        user_id: created.userId,
        course_code: created.courseCode,
        color: created.color,
      },
    ];
  }

  async deleteUserCourse(courseId: string, userId: string) {
    await this.prisma.userCourse.deleteMany({
      where: { id: String(courseId), userId },
    });
    return { deleted: true, id: courseId };
  }
}
