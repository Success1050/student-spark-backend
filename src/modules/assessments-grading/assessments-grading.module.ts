import { Module } from '@nestjs/common';
import { AssessmentsGradingController } from './assessments-grading.controller.js';
import { AssessmentsGradingService } from './assessments-grading.service.js';
import { PositionRankingCalculator } from './calculators/position-ranking.calculator.js';
import { GpaCgpaCalculator } from './calculators/gpa-cgpa.calculator.js';
import { LiveRankingsGateway } from './gateways/live-rankings.gateway.js';
import { LiveRankingsService } from './live-rankings.service.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [AiModule],
  controllers: [AssessmentsGradingController],
  providers: [
    AssessmentsGradingService,
    LiveRankingsService,
    LiveRankingsGateway,
    PositionRankingCalculator,
    GpaCgpaCalculator,
  ],
  exports: [
    AssessmentsGradingService,
    LiveRankingsService,
    LiveRankingsGateway,
    PositionRankingCalculator,
    GpaCgpaCalculator,
  ],
})
export class AssessmentsGradingModule {}
