import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TournamentsGateway } from './gateways/tournaments.gateway.js';
import { TournamentsController } from './tournaments.controller.js';
import { TournamentsService } from './tournaments.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [TournamentsController],
  providers: [TournamentsService, TournamentsGateway],
  exports: [TournamentsService, TournamentsGateway],
})
export class TournamentsModule {}
