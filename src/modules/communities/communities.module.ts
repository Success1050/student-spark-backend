import { Module } from '@nestjs/common';
import { CommunitiesController } from './communities.controller.js';
import { CommunitiesService } from './communities.service.js';
import { CommunitiesGateway } from './gateways/communities.gateway.js';

@Module({
  controllers: [CommunitiesController],
  providers: [CommunitiesService, CommunitiesGateway],
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
