import { Module } from '@nestjs/common';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';
import { QuizBattleGateway } from './gateways/quiz-battle.gateway.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [AiModule],
  controllers: [GamesController],
  providers: [GamesService, QuizBattleGateway],
  exports: [GamesService],
})
export class GamesModule {}
