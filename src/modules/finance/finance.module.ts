import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceWebhookController } from './finance-webhook.controller.js';
import { FinanceService } from './finance.service.js';

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [FinanceController, FinanceWebhookController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
