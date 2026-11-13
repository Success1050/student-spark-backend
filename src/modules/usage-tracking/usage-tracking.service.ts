import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export type TrackedAction =
  | 'note_upload'
  | 'study_plan_generate'
  | 'pq_generate'
  | 'quiz_generate'
  | 'past_question_upload';

const PLAN_LIMITS: Record<TrackedAction, Record<'free' | 'premium' | 'pro', number>> = {
  note_upload: { free: 2, premium: 5, pro: Infinity },
  study_plan_generate: { free: 1, premium: 3, pro: Infinity },
  pq_generate: { free: 2, premium: 5, pro: Infinity },
  quiz_generate: { free: 2, premium: 5, pro: Infinity },
  past_question_upload: { free: 2, premium: 5, pro: Infinity },
};

/**
 * Replaces the duplicated usage_tracking checks across studentspark_backend/AIRoutes/*
 */
@Injectable()
export class UsageTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyQuota(
    userId: string,
    actionType: TrackedAction,
  ): Promise<{ plan: 'free' | 'premium' | 'pro'; limit: number; usedToday: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    const userPlan = (user?.plan ?? 'free') as 'free' | 'premium' | 'pro';
    const limit = PLAN_LIMITS[actionType][userPlan] ?? PLAN_LIMITS[actionType].free;

    if (limit === Infinity) {
      return { plan: userPlan, limit, usedToday: 0 };
    }

    const today = new Date().toISOString().split('T')[0];
    const records = await this.prisma.usageTracking.findMany({
      where: {
        userId,
        actionType,
        actionDate: today,
      },
    });

    const usedToday = records.reduce((sum, r) => sum + (r.count || 1), 0);

    if (usedToday >= limit) {
      throw new ForbiddenException({
        error: `Daily limit reached for ${userPlan} plan (${limit} per day). Upgrade your plan for more access.`,
        limitReached: true,
      });
    }

    return { plan: userPlan, limit, usedToday };
  }

  async recordUsage(userId: string, actionType: TrackedAction): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const created = await this.prisma.usageTracking.create({
      data: {
        userId,
        actionType,
        actionDate: today,
        count: 1,
      },
    });
    return created.id;
  }

  async rollbackUsage(usageRecordId: string | null): Promise<void> {
    if (!usageRecordId) return;
    await this.prisma.usageTracking.delete({ where: { id: usageRecordId } }).catch(() => undefined);
  }
}
