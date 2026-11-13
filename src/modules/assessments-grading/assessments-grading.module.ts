import { Module } from '@nestjs/common';
import { AssessmentsGradingController } from './assessments-grading.controller.js';
import { AssessmentsGradingService } from './assessments-grading.service.js';
import { PositionRankingCalculator } from './calculators/position-ranking.calculator.js';
import { GpaCgpaCalculator } from './calculators/gpa-cgpa.calculator.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [AiModule],
  controllers: [AssessmentsGradingController],
  providers: [AssessmentsGradingService, PositionRankingCalculator, GpaCgpaCalculator],
  exports: [AssessmentsGradingService, PositionRankingCalculator, GpaCgpaCalculator],
})
export class AssessmentsGradingModule {}
