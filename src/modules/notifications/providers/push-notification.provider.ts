import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

/**
 * Mobile Push Notifications Provider using expo-server-sdk
 * Sends push notifications to registered Expo Push Tokens on iOS & Android.
 */
@Injectable()
export class PushNotificationProvider {
  private readonly logger = new Logger(PushNotificationProvider.name);
  private readonly expo = new Expo();

  async sendPushNotification(params: {
    expoPushTokens: string[];
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }) {
    const validTokens = (params.expoPushTokens || []).filter((token) =>
      Expo.isExpoPushToken(token),
    );

    if (validTokens.length === 0) {
      return { sent: 0, skipped: params.expoPushTokens?.length || 0 };
    }

    const messages: ExpoPushMessage[] = validTokens.map((to) => ({
      to,
      sound: 'default',
      title: params.title,
      body: params.body,
      priority: 'high',
      data: params.data || {},
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    let sentCount = 0;

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        sentCount += ticketChunk.length;
      } catch (error) {
        this.logger.warn(`Failed to send Expo push notification chunk: ${String(error)}`);
      }
    }

    this.logger.log(
      `Sent Expo Push Notification "${params.title}" to ${sentCount} device(s)`,
    );
    return { sent: sentCount };
  }
}
