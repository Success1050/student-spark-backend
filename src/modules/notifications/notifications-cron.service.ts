import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service.js';
import { getWatNow } from '../../common/utils/helpers.util.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Automated Scheduled Notification Reminders:
 * 1. Morning Study Plan Task Digest (08:00 WAT)
 * 2. Evening Streak-Saver Reminder (20:00 WAT) for students who haven't completed a task today
 */
@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendMorningStudyTaskReminders() {
    try {
      const watNow = getWatNow();
      const todayStr = watNow.toISOString().split('T')[0];
      const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
      const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

      const pendingTasks = await this.prisma.studyTask.findMany({
        where: {
          date: { gte: startOfDay, lte: endOfDay },
          completed: false,
          isManualSession: false,
        },
        select: {
          userId: true,
          title: true,
          topic: true,
        },
      });

      const tasksByUser = new Map<string, string[]>();
      for (const task of pendingTasks) {
        const list = tasksByUser.get(task.userId) || [];
        list.push(task.topic || task.title);
        tasksByUser.set(task.userId, list);
      }

      for (const [userId, topics] of tasksByUser.entries()) {
        await this.notifications.dispatchNotification({
          userId,
          title: `📚 You have ${topics.length} study task${topics.length > 1 ? 's' : ''} today!`,
          body: `Focus for today: ${topics.slice(0, 3).join(', ')}. Let's crush your study goals!`,
          category: 'STUDY',
          deepLink: '/(main)/studyPlan',
          channels: { inApp: true, push: true, email: false },
        });
      }
    } catch (error) {
      this.logger.warn(`Morning study task cron failed: ${String(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_8PM)
  async sendEveningStreakSaverReminders() {
    try {
      const watNow = getWatNow();
      const todayStr = watNow.toISOString().split('T')[0];

      const usersAtRisk = await this.prisma.user.findMany({
        where: {
          streak: { gt: 0 },
          NOT: { lastCompletedDate: todayStr },
        },
        select: {
          id: true,
          streak: true,
        },
        take: 200,
      });

      for (const u of usersAtRisk) {
        await this.notifications.dispatchNotification({
          userId: u.id,
          title: `🔥 Protect your ${u.streak}-day study streak!`,
          body: `Complete at least one study session or task before midnight to keep your ${u.streak}-day streak alive.`,
          category: 'STUDY',
          deepLink: '/(main)/tracker',
          channels: { inApp: true, push: true, email: false },
        });
      }
    } catch (error) {
      this.logger.warn(`Evening streak-saver cron failed: ${String(error)}`);
    }
  }
}
