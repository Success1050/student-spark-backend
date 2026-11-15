import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PushNotificationProvider } from './providers/push-notification.provider.js';
import { EmailNotificationProvider } from './providers/email-notification.provider.js';
import { InAppNotificationGateway } from './gateways/in-app-notification.gateway.js';

export type NotificationCategory =
  | 'STUDY'
  | 'SCHOOL'
  | 'FINANCE'
  | 'WALLET'
  | 'GAMES'
  | 'SYSTEM'
  | 'GENERAL';

export interface DispatchNotificationParams {
  userId: string;
  schoolId?: string | null;
  title: string;
  body: string;
  category?: NotificationCategory | string;
  deepLink?: string | null;
  dataJson?: Record<string, unknown> | null;
  channels?: {
    inApp?: boolean;
    push?: boolean;
    email?: boolean;
  };
  emailSubject?: string;
  emailCtaLabel?: string;
  emailCtaUrl?: string;
}

/**
 * Unified 3-Channel Notification Service:
 * 1. In-App Notification Center (persisted in PostgreSQL + pushed live via Socket.io)
 * 2. Mobile Push Notifications (Expo Push Service via expo-server-sdk)
 * 3. Email Notifications (Transactional & Academic alerts via Nodemailer)
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushProvider: PushNotificationProvider,
    private readonly emailProvider: EmailNotificationProvider,
    private readonly inAppGateway: InAppNotificationGateway,
  ) {}

  private formatNotification(n: {
    id: string;
    userId: string;
    schoolId: string | null;
    title: string;
    body: string;
    category: string;
    deepLink: string | null;
    dataJson: unknown;
    isRead: boolean;
    createdAt: Date;
  }) {
    const dataObj =
      n.dataJson && typeof n.dataJson === 'object' && !Array.isArray(n.dataJson)
        ? (n.dataJson as Record<string, unknown>)
        : {};

    return {
      ...n,
      data: {
        ...dataObj,
        route:
          n.deepLink ||
          (typeof dataObj.route === 'string' ? dataObj.route : null),
      },
      user_id: n.userId,
      school_id: n.schoolId,
      deep_link: n.deepLink,
      data_json: n.dataJson,
      is_read: n.isRead,
      created_at: n.createdAt.toISOString(),
    };
  }

  async registerDevicePushToken(
    userId: string,
    expoPushToken: string,
    platform: 'android' | 'ios' = 'android',
  ) {
    if (!userId || !expoPushToken) {
      throw new BadRequestException('userId and expoPushToken are required');
    }

    const tokenRecord = await this.prisma.devicePushToken.upsert({
      where: { expoPushToken },
      update: {
        userId,
        platform: platform || 'android',
      },
      create: {
        userId,
        expoPushToken,
        platform: platform || 'android',
      },
    });

    return {
      registered: true,
      token: tokenRecord,
    };
  }

  async removeDevicePushToken(expoPushToken: string) {
    if (!expoPushToken) return { removed: false };
    await this.prisma.devicePushToken
      .deleteMany({ where: { expoPushToken } })
      .catch(() => undefined);
    return { removed: true };
  }

  async dispatchNotification(params: DispatchNotificationParams) {
    const {
      userId,
      schoolId,
      title,
      body,
      category = 'GENERAL',
      deepLink = null,
      dataJson = null,
      channels = { inApp: true, push: true, email: false },
      emailSubject,
      emailCtaLabel,
      emailCtaUrl,
    } = params;

    if (!userId || !title || !body) {
      return null;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { devicePushTokens: true },
      });

      if (!user) return null;

      let formattedNotification: Record<string, unknown> | null = null;

      // 1. In-App Notification (DB + Live Socket.io)
      if (channels.inApp !== false && user.notifyInApp) {
        const created = await this.prisma.notification.create({
          data: {
            userId: user.id,
            schoolId: schoolId ?? user.schoolId ?? null,
            title,
            body,
            category: String(category).toUpperCase(),
            deepLink,
            dataJson: (dataJson || {}) as object,
            isRead: false,
          },
        });

        formattedNotification = this.formatNotification(created);

        const unreadCount = await this.prisma.notification.count({
          where: { userId: user.id, isRead: false },
        });

        this.inAppGateway.emitNewNotification(
          user.id,
          formattedNotification,
          unreadCount,
        );
      }

      // 2. Mobile Push Notification (Expo Push Service)
      if (channels.push !== false && user.notifyPush && user.devicePushTokens.length > 0) {
        const tokens = user.devicePushTokens.map((t) => t.expoPushToken);
        void this.pushProvider.sendPushNotification({
          expoPushTokens: tokens,
          title,
          body,
          data: {
            ...(dataJson || {}),
            category,
            deepLink: deepLink || '/(main)/Home',
            notificationId: formattedNotification?.id,
          },
        });
      }

      // 3. Email Notification (Nodemailer Branded HTML)
      if (channels.email === true && user.notifyEmail && user.email) {
        const html = this.emailProvider.buildBrandedEmailHtml({
          recipientName: user.fullName || user.username || undefined,
          title,
          body,
          category: String(category).toUpperCase(),
          ctaLabel: emailCtaLabel,
          ctaUrl: emailCtaUrl,
        });

        void this.emailProvider.sendEmail({
          to: user.email,
          subject: emailSubject || `StudentSpark: ${title}`,
          html,
        });
      }

      return formattedNotification;
    } catch (error) {
      this.logger.warn(`Failed to dispatch notification to user ${userId}: ${String(error)}`);
      return null;
    }
  }

  async listUserNotifications(userId: string, category?: string) {
    if (!userId) {
      return { userId: '', unreadCount: 0, notifications: [] };
    }

    const whereClause: {
      userId: string;
      isRead?: boolean;
      category?: string;
    } = { userId };

    if (category && category !== 'ALL') {
      if (category === 'UNREAD') {
        whereClause.isRead = false;
      } else {
        whereClause.category = category.toUpperCase();
      }
    }

    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      userId,
      unreadCount,
      notifications: notifications.map((n) => this.formatNotification(n)),
    };
  }

  async getUnreadCount(userId: string) {
    if (!userId) return { unreadCount: 0 };
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  async markOneAsRead(notificationId: string, userId?: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id: String(notificationId) },
    });
    if (!existing) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.notification.update({
      where: { id: existing.id },
      data: { isRead: true },
    });

    const targetUserId = userId || existing.userId;
    const unreadCount = await this.prisma.notification.count({
      where: { userId: targetUserId, isRead: false },
    });
    this.inAppGateway.emitUnreadCount(targetUserId, unreadCount);

    return {
      notification: this.formatNotification(updated),
      unreadCount,
    };
  }

  async markAllAsRead(userId: string) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    this.inAppGateway.emitUnreadCount(userId, 0);

    return { userId, markedRead: true, unreadCount: 0 };
  }

  async deleteNotification(notificationId: string, userId?: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id: String(notificationId) },
    });
    if (!existing) {
      return { deleted: false };
    }

    await this.prisma.notification.delete({
      where: { id: existing.id },
    });

    const targetUserId = userId || existing.userId;
    const unreadCount = await this.prisma.notification.count({
      where: { userId: targetUserId, isRead: false },
    });
    this.inAppGateway.emitUnreadCount(targetUserId, unreadCount);

    return { deleted: true, unreadCount };
  }

  async getPreferences(userId: string) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        notifyInApp: true,
        notifyPush: true,
        notifyEmail: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      userId: user.id,
      notifyInApp: user.notifyInApp,
      notifyPush: user.notifyPush,
      notifyEmail: user.notifyEmail,
      notify_in_app: user.notifyInApp,
      notify_push: user.notifyPush,
      notify_email: user.notifyEmail,
    };
  }

  async updatePreferences(
    userId: string,
    payload: {
      notifyInApp?: boolean;
      notifyPush?: boolean;
      notifyEmail?: boolean;
    },
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(typeof payload.notifyInApp === 'boolean'
          ? { notifyInApp: payload.notifyInApp }
          : {}),
        ...(typeof payload.notifyPush === 'boolean'
          ? { notifyPush: payload.notifyPush }
          : {}),
        ...(typeof payload.notifyEmail === 'boolean'
          ? { notifyEmail: payload.notifyEmail }
          : {}),
      },
      select: {
        id: true,
        notifyInApp: true,
        notifyPush: true,
        notifyEmail: true,
      },
    });

    return {
      userId: updated.id,
      notifyInApp: updated.notifyInApp,
      notifyPush: updated.notifyPush,
      notifyEmail: updated.notifyEmail,
      notify_in_app: updated.notifyInApp,
      notify_push: updated.notifyPush,
      notify_email: updated.notifyEmail,
    };
  }

  async sendTestNotification(userId: string) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { devicePushTokens: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const notification = await this.dispatchNotification({
      userId,
      title: '🔔 3-Channel Notification Active!',
      body: 'Your In-App Notification Center, Mobile Push Notifications, and Email Alerts are all connected and working in real time.',
      category: 'SYSTEM',
      deepLink: '/(main)/Home',
      channels: {
        inApp: Boolean(user.notifyInApp),
        push: Boolean(user.notifyPush),
        email: Boolean(user.notifyEmail),
      },
      emailSubject: '⚡ StudentSpark 3-Channel Notification Test',
    });

    return {
      success: true,
      message: 'Dispatched notifications respecting user channel preferences',
      notification,
      channelsDispatched: {
        inApp: Boolean(user.notifyInApp),
        push: user.notifyPush ? user.devicePushTokens.length : 0,
        email: Boolean(user.notifyEmail),
      },
    };
  }
}
