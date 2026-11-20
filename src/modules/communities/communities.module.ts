import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CommunitiesController } from './communities.controller.js';
import { CommunitiesService } from './communities.service.js';
import { CommunitiesGateway } from './gateways/communities.gateway.js';

@Module({
  imports: [NotificationsModule],
  controllers: [CommunitiesController],
  providers: [CommunitiesService, CommunitiesGateway],
  exports: [CommunitiesService, CommunitiesGateway],
})
export class CommunitiesModule {}
