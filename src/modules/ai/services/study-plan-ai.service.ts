import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../database/prisma.service.js';
import { UsageTrackingService } from '../../usage-tracking/usage-tracking.service.js';
import { getRandomColor, getWatNow } from '../../../common/utils/helpers.util.js';
import { OpenAiService } from './openai.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

export interface StudyPlanTaskItem {
  id: string;
  topic: string;
  subject: string;
  priority: 'High' | 'Medium' | 'Low';
  suggested_time: string;
  learning_method: string;
  difficulty_level: string;
  duration_minutes: number;
  completed: boolean;
}

export interface StudyPlanBreakReminder {
  duration_minutes: number;
  after_task_number: number;
  activity_suggestion: string;
}

export interface StudyPlanDayItem {
  date: string;
  tasks: StudyPlanTaskItem[];
  day_name: string;
  daily_goal: string;
  day_number: number;
  daily_focus: string;
  total_tasks: number;
  is_break_day: boolean;
  break_reminders: StudyPlanBreakReminder[];
  estimated_hours: number;
}

export interface StudyPlanMetadata {
  exam_date: string;
  start_date: string;
  total_days: number;
  study_strategy: string;
  subjects_count: number;
  total_study_hours: number;
}

export interface FullStudyPlanJson {
  days: StudyPlanDayItem[];
  plan_metadata: StudyPlanMetadata;
  study_tips: string[];
}

/**
 * Merged from studentspark_backend/AIRoutes/studyPlanRoute.js
 * Generates WAT (Africa/Lagos) timezone-aware daily study plans and tasks from student notes.
 */
@Injectable()
export class StudyPlanAiService {
  private readonly logger = new Logger(StudyPlanAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageTracking: UsageTrackingService,
    private readonly openAiService: OpenAiService,
    private readonly notifications: NotificationsService,
  ) {}

  async generateStudyPlanFromNotes(params: {
    userId: string;
    durationDays: number;
    hoursPerDay: number;
    studyHoursRange?: string;
    examDate?: string;
    planName?: string;
    subjects?: string[];
    noteIds?: string[];
    aiOptions?: {
      includeRevision?: boolean;
      avoidWeekends?: boolean;
      includeBreaks?: boolean;
    };
  }) {
    const {
      userId,
      durationDays,
      hoursPerDay,
      studyHoursRange = '4-5',
      examDate = '',
      planName = 'AI Study Plan',
      subjects = [],
      noteIds,
      aiOptions,
    } = params;

    if (!userId || !durationDays || !hoursPerDay) {
      throw new BadRequestException('Missing required fields (userId, duration, hours)');
    }

    await this.usageTracking.verifyQuota(userId, 'study_plan_generate');

    const stringNoteIds = (noteIds || []).map(String);
    const notes = await this.prisma.note.findMany({
      where: {
        userId,
        ...(stringNoteIds.length > 0 ? { id: { in: stringNoteIds } } : {}),
      },
      select: {
        id: true,
        title: true,
        courseCode: true,
        listsOfTopic: true,
      },
    });

    if (!notes.length) {
      throw new BadRequestException('No notes found to generate a study plan from.');
    }

    const watNow = getWatNow();
    const startDateStr = watNow.toISOString().split('T')[0];
    const endDate = new Date(watNow);
    endDate.setDate(endDate.getDate() + Number(durationDays) - 1);

    const formattedNotes = notes
      .map((n, idx) => {
        const rawTopics = Array.isArray(n.listsOfTopic) ? n.listsOfTopic : [];
        const topicLabels = rawTopics.map((t: unknown) => {
          if (typeof t === 'string') return t;
          if (t && typeof t === 'object') {
            const obj = t as Record<string, unknown>;
            return String(obj.topic || obj.title || '');
          }
          return '';
        }).filter(Boolean);
        return `${idx + 1}. Course: ${n.courseCode} | Title: ${n.title} | Topics: ${topicLabels.join(', ')}`;
      })
      .join('\n');

    let createdPlanId: string | null = null;
    let usageRecordId: string | null = null;

    try {
      const raw = await this.openAiService.chatCompletion({
        systemPrompt: `You are an expert academic study planner.
Current WAT (Africa/Lagos, UTC+1) date: ${startDateStr}.
Day 1 MUST start on ${startDateStr}, and each subsequent day increments the date by 1 day (YYYY-MM-DD).
Generate a ${durationDays}-day study plan (${hoursPerDay} hours/day) for exam date: ${examDate || endDate.toISOString().split('T')[0]}.
Options: includeRevision=${Boolean(aiOptions?.includeRevision)}, avoidWeekends=${Boolean(aiOptions?.avoidWeekends)}, includeBreaks=${Boolean(aiOptions?.includeBreaks ?? true)}.

Return ONLY valid JSON in this exact structure:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "day_name": "Monday",
      "day_number": 1,
      "daily_goal": "Master core concepts",
      "daily_focus": "Course/Topic focus",
      "total_tasks": 2,
      "is_break_day": false,
      "estimated_hours": ${hoursPerDay},
      "break_reminders": [
        {
          "duration_minutes": 15,
          "after_task_number": 1,
          "activity_suggestion": "Stretch and hydrate"
        }
      ],
      "tasks": [
        {
          "id": "day1-task1",
          "topic": "Specific Topic",
          "subject": "Course Code or Note Title",
          "priority": "High",
          "suggested_time": "09:00 AM",
          "learning_method": "Reading",
          "difficulty_level": "Medium",
          "duration_minutes": 60,
          "completed": false
        }
      ]
    }
  ],
  "plan_metadata": {
    "exam_date": "${examDate || endDate.toISOString().split('T')[0]}",
    "start_date": "${startDateStr}",
    "total_days": ${Number(durationDays)},
    "study_strategy": "Spaced repetition and active recall",
    "subjects_count": ${notes.length},
    "total_study_hours": ${Number(durationDays) * Number(hoursPerDay)}
  },
  "study_tips": [
    "Review high-priority topics in the morning.",
    "Test yourself with active recall after each study block."
  ]
}`,
        userPrompt: `Create a ${durationDays}-day study plan named "${planName}" (${hoursPerDay} hours/day) covering these notes:\n${formattedNotes}`,
      });

      const parsed = this.openAiService.cleanJsonOutput<FullStudyPlanJson>(raw, {
        days: [],
        plan_metadata: {
          exam_date: examDate || endDate.toISOString().split('T')[0],
          start_date: startDateStr,
          total_days: Number(durationDays),
          study_strategy: 'Balanced study schedule',
          subjects_count: notes.length,
          total_study_hours: Number(durationDays) * Number(hoursPerDay),
        },
        study_tips: [],
      });

      if (!parsed.days?.length) {
        throw new BadRequestException('AI failed to generate a valid study plan');
      }

      // Ensure every task has a unique ID and completed boolean
      parsed.days = parsed.days.map((day, dIdx) => {
        const dayDate = new Date(watNow);
        dayDate.setDate(dayDate.getDate() + dIdx);
        const isoDate = day.date || dayDate.toISOString().split('T')[0];
        const tasks = (day.tasks || []).map((t, tIdx) => ({
          ...t,
          id: t.id || `d${dIdx + 1}-t${tIdx + 1}-${randomUUID().slice(0, 6)}`,
          completed: Boolean(t.completed),
          duration_minutes: Number(t.duration_minutes) || 60,
        }));
        return {
          ...day,
          date: isoDate,
          day_number: Number(day.day_number) || dIdx + 1,
          total_tasks: tasks.length,
          tasks,
        };
      });

      // Delete old plans and non-manual tasks for this user
      await this.prisma.studyTask.deleteMany({ where: { userId, isManualSession: false } });
      await this.prisma.studyPlan.deleteMany({ where: { userId } });

      const subjectList =
        subjects.length > 0
          ? subjects
          : notes.map((n) => n.courseCode || n.title);

      const createdPlan = await this.prisma.studyPlan.create({
        data: {
          userId,
          planName,
          examDate: examDate || endDate.toISOString().split('T')[0],
          subjects: subjectList,
          studyHoursRange,
          startDate: watNow,
          endDate,
          durationDays: Number(durationDays),
          hoursPerDay: Number(hoursPerDay),
          planJson: parsed as unknown as object,
          studyProgress: 0,
        },
      });
      createdPlanId = createdPlan.id;

      const tasksToInsert = parsed.days.flatMap((dayObj) =>
        (dayObj.tasks || []).map((task) => ({
          userId,
          studyPlanId: createdPlan.id,
          date: new Date(dayObj.date || watNow),
          dayNumber: Number(dayObj.day_number) || 1,
          title: task.subject || 'Study Session',
          topic: task.topic || task.subject || 'General Review',
          courseCode: task.subject || 'General',
          color: getRandomColor(),
          startTime: watNow,
          endTime: watNow,
          durationMinutes: Number(task.duration_minutes) || 60,
          completed: false,
          isManualSession: false,
        })),
      );

      if (tasksToInsert.length > 0) {
        await this.prisma.studyTask.createMany({ data: tasksToInsert });
      }

      // Sync courses on user profile
      const newCourses = [
        ...new Set(notes.map((n) => n.courseCode).filter(Boolean)),
      ];
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { courses: true },
      });
      if (user) {
        const mergedCourses = [...new Set([...(user.courses || []), ...newCourses])];
        await this.prisma.user.update({
          where: { id: userId },
          data: { courses: mergedCourses },
        });
      }

      usageRecordId = await this.usageTracking.recordUsage(userId, 'study_plan_generate');

      void this.notifications.dispatchNotification({
        userId,
        title: `📅 Study Plan Ready: ${planName}`,
        body: `Your ${durationDays}-day AI study plan (${tasksToInsert.length} study sessions) has been scheduled. Stay consistent!`,
        category: 'STUDY',
        deepLink: '/(main)/studyPlan',
        channels: { inApp: true, push: true, email: true },
        emailSubject: `📅 Your ${durationDays}-Day AI Study Plan "${planName}" is Ready`,
      });

      return {
        message: 'Study plan generated successfully',
        studyPlan: {
          ...createdPlan,
          user_id: createdPlan.userId,
          plan_name: createdPlan.planName,
          exam_date: createdPlan.examDate,
          duration_days: createdPlan.durationDays,
          study_hours_range: createdPlan.studyHoursRange,
          plan_data: parsed,
        },
        totalTasks: tasksToInsert.length,
      };
    } catch (error) {
      this.logger.error('Study plan generation failed, rolling back', error);
      if (createdPlanId) {
        await this.prisma.studyTask
          .deleteMany({ where: { studyPlanId: createdPlanId } })
          .catch(() => undefined);
        await this.prisma.studyPlan
          .delete({ where: { id: createdPlanId } })
          .catch(() => undefined);
      }
      if (usageRecordId) {
        await this.usageTracking.rollbackUsage(usageRecordId);
      }
      throw error;
    }
  }
}
