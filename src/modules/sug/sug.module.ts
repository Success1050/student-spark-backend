import { Module } from '@nestjs/common';
import { SugController } from './sug.controller.js';
import { SugService } from './sug.service.js';
import { SugGateway } from './sug.gateway.js';

@Module({
  controllers: [SugController],
  providers: [SugService, SugGateway],
  exports: [SugService, SugGateway],
})
export class SugModule {}
