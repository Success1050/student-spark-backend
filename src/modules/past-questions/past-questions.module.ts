import { Module } from '@nestjs/common';
import { PastQuestionsController } from './past-questions.controller.js';
import { PastQuestionsService } from './past-questions.service.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [AiModule],
  controllers: [PastQuestionsController],
  providers: [PastQuestionsService],
  exports: [PastQuestionsService],
})
export class PastQuestionsModule {}
