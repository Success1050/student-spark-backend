import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('push-token')
  registerPushToken(
    @Body()
    body: {
      userId?: string;
      expoPushToken?: string;
      token?: string;
      platform?: 'android' | 'ios' | string;
    },
    @UserId() userId: string,
  ) {
    const token = body.expoPushToken || body.token || '';
    return this.notificationsService.registerDevicePushToken(
      userId,
      token,
      (body.platform as any) || 'android',
    );
  }

  @Delete('push-token')
  removePushToken(
    @Body('expoPushToken') expoPushToken?: string,
    @Body('token') token?: string,
  ) {
    return this.notificationsService.removeDevicePushToken(expoPushToken || token || '');
  }

  @Get()
  list(
    @UserId() userId: string,
    @Query('category') category: string | undefined,
  ) {
    return this.notificationsService.listUserNotifications(userId, category);
  }

  @Get('unread-count')
  unreadCount(@UserId() userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch('read-all')
  markAllRead(@UserId() userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Patch(':id/read')
  markOneRead(
    @Param('id') id: string,
    @UserId() userId: string,
  ) {
    return this.notificationsService.markOneAsRead(id, userId);
  }

  @Delete(':id')
  deleteOne(
    @Param('id') id: string,
    @UserId() userId: string,
  ) {
    return this.notificationsService.deleteNotification(id, userId);
  }

  @Get('preferences')
  getPreferences(@UserId() userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  @Patch('preferences')
  updatePreferences(
    @Body()
    body: {
      userId?: string;
      notifyInApp?: boolean;
      notifyPush?: boolean;
      notifyEmail?: boolean;
    },
    @UserId() userId: string,
  ) {
    return this.notificationsService.updatePreferences(userId, {
      notifyInApp: body.notifyInApp,
      notifyPush: body.notifyPush,
      notifyEmail: body.notifyEmail,
    });
  }

  @Post('test')
  sendTest(@UserId() userId: string) {
    return this.notificationsService.sendTestNotification(userId);
  }
}
