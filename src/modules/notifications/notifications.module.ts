import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsCronService } from './notifications-cron.service.js';
import { PushNotificationProvider } from './providers/push-notification.provider.js';
import { EmailNotificationProvider } from './providers/email-notification.provider.js';
import { InAppNotificationGateway } from './gateways/in-app-notification.gateway.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsCronService,
    PushNotificationProvider,
    EmailNotificationProvider,
    InAppNotificationGateway,
  ],
  exports: [NotificationsService, EmailNotificationProvider, PushNotificationProvider],
})
export class NotificationsModule {}
