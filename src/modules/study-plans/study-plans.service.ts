import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { FullStudyPlanJson } from '../ai/services/study-plan-ai.service.js';

/**
 * Replaces Supabase 'student_studyplans' and 'study_tasks' queries
 * (getStudentPlan, updateCompletedTasksInDB)
 */
@Injectable()
export class StudyPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private formatStudyPlan(plan: {
    id: string;
    userId: string;
    planName: string;
    examDate: string | null;
    subjects: string[];
    studyHoursRange: string;
    startDate: Date;
    endDate: Date;
    durationDays: number;
    hoursPerDay: number;
    planJson: unknown;
    completed: boolean;
    studyProgress: number;
    createdAt: Date;
    tasks?: Array<{
      id: string;
      dayNumber: number;
      title: string;
      topic: string | null;
      courseCode: string;
      durationMinutes: number;
      completed: boolean;
    }>;
  }) {
    return {
      ...plan,
      user_id: plan.userId,
      plan_name: plan.planName,
      exam_date: plan.examDate,
      duration_days: plan.durationDays,
      study_hours_range: plan.studyHoursRange,
      plan_data: plan.planJson,
      progress_percentage: plan.studyProgress,
      study_tasks: (plan.tasks || []).map((t) => ({
        ...t,
        study_plan_id: plan.id,
        day_number: t.dayNumber,
        subject: t.courseCode || t.title,
        duration_minutes: t.durationMinutes,
      })),
      created_at: plan.createdAt.toISOString(),
    };
  }

  async findAllByUser(userId: string) {
    if (!userId) return [];
    const plans = await this.prisma.studyPlan.findMany({
      where: { userId },
      include: { tasks: true },
      orderBy: { createdAt: 'desc' },
    });
    return plans.map((p) => this.formatStudyPlan(p));
  }

  async updateCompletedTasks(
    planId: string,
    userId: string,
    completedTaskIds: string[],
  ) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { id: String(planId), ...(userId ? { userId } : {}) },
      include: { tasks: true },
    });

    if (!plan) {
      throw new NotFoundException('Study plan not found');
    }

    const completedSet = new Set((completedTaskIds || []).map(String));
    const currentPlanData = (plan.planJson || {}) as unknown as FullStudyPlanJson;

    let totalTasksCount = 0;
    let completedTasksCount = 0;

    const updatedDays = (currentPlanData.days || []).map((day) => ({
      ...day,
      tasks: (day.tasks || []).map((task) => {
        totalTasksCount += 1;
        const isDone = completedSet.has(String(task.id));
        if (isDone) completedTasksCount += 1;
        return {
          ...task,
          completed: isDone,
        };
      }),
    }));

    const updatedPlanJson: FullStudyPlanJson = {
      ...currentPlanData,
      days: updatedDays,
    };

    const progress =
      totalTasksCount > 0
        ? Math.round((completedTasksCount / totalTasksCount) * 100)
        : 0;

    const updated = await this.prisma.studyPlan.update({
      where: { id: plan.id },
      data: {
        planJson: updatedPlanJson as unknown as object,
        studyProgress: progress,
        completed: progress === 100,
      },
      include: { tasks: true },
    });

    return [this.formatStudyPlan(updated)];
  }
}
