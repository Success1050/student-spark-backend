import { Module } from '@nestjs/common';
import { StudyPlansController } from './study-plans.controller.js';
import { StudyPlansService } from './study-plans.service.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [AiModule],
  controllers: [StudyPlansController],
  providers: [StudyPlansService],
  exports: [StudyPlansService],
})
export class StudyPlansModule {}
