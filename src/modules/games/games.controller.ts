import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { GamesService } from './games.service.js';
import {
  CreateBattleDto,
  GenerateSoloGameDto,
  InviteBattleFriendDto,
  JoinBattleDto,
  SubmitSoloScoreDto,
} from './dto/games.dto.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller(['games', 'api/games'])
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get('overview')
  getArcadeOverview(@UserId() userId: string) {
    return this.gamesService.getArcadeOverview(userId);
  }

  @Post('solo/generate')
  generateSoloGame(
    @Body() dto: GenerateSoloGameDto,
    @UserId() userId: string,
  ) {
    return this.gamesService.generateSoloGame(userId, dto);
  }

  @Post('solo/submit')
  submitSoloScore(
    @Body() dto: SubmitSoloScoreDto,
    @UserId() userId: string,
  ) {
    return this.gamesService.submitSoloScore(userId, dto);
  }

  @Get('stats')
  getUserStats(@UserId() userId: string) {
    return this.gamesService.getUserGameStats(userId);
  }

  @Get('leaderboard')
  getLeaderboard(@Query('schoolId') schoolId?: string) {
    return this.gamesService.getArcadeLeaderboard(schoolId);
  }

  @Get('ladder')
  getScholarLadder(@UserId() userId: string) {
    return this.gamesService.getScholarLadder(userId);
  }

  @Post('battle/create')
  createBattle(
    @Body() dto: CreateBattleDto,
    @UserId() userId: string,
  ) {
    return this.gamesService.createBattleMatch(userId, dto);
  }

  @Post('battle/join')
  joinBattle(
    @Body() dto: JoinBattleDto,
    @UserId() userId: string,
  ) {
    return this.gamesService.joinBattleMatch(userId, dto.inviteCode);
  }

  @Get('battle/match/:code')
  getBattleMatch(@Param('code') code: string) {
    return this.gamesService.getBattleMatchByPin(code);
  }

  @Post('battle/invite')
  inviteFriend(
    @Body() dto: InviteBattleFriendDto,
    @UserId() userId: string,
  ) {
    return this.gamesService.inviteBattleFriend(userId, dto);
  }
}
