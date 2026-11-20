import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsService } from './promotions.service.js';

@Module({
  imports: [FinanceModule, NotificationsModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
