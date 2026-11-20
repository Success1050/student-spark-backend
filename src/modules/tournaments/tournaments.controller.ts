import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import {
  AdminRegisterStudentsDto,
  CreateTournamentDto,
  ReportAntiCheatEventDto,
  SendSpectatorCheerDto,
  SubmitTournamentAnswerDto,
  UpdateTournamentStatusDto,
} from './dto/tournaments.dto.js';
import { TournamentsService } from './tournaments.service.js';

@Controller(['tournaments', 'api/tournaments'])
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get('hub')
  getHub(@UserId() userId: string, @Query('schoolId') schoolId?: string) {
    return this.tournamentsService.getHub(userId, schoolId);
  }

  @Get()
  listCompat(@UserId() userId: string, @Query('schoolId') schoolId?: string) {
    return this.tournamentsService.getHub(userId, schoolId);
  }

  @Post()
  createTournament(
    @UserId() userId: string,
    @Body() dto: CreateTournamentDto,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.tournamentsService.createTournament(userId, dto, schoolId);
  }

  @Get(':id')
  getDetail(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.tournamentsService.getTournamentDetail(userId, tournamentId, schoolId);
  }

  @Patch(':id/status')
  updateStatus(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Body() dto: UpdateTournamentStatusDto,
  ) {
    return this.tournamentsService.updateTournamentStatus(userId, tournamentId, dto.status);
  }

  @Get(':id/school-roster')
  getSchoolRoster(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.tournamentsService.getSchoolRosterForTournament(userId, tournamentId, schoolId);
  }

  @Post(':id/register-students')
  adminRegisterStudents(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Body() dto: AdminRegisterStudentsDto,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.tournamentsService.adminRegisterStudents(userId, tournamentId, dto, schoolId);
  }

  @Post(':id/entries/:entryId/approve')
  approveEntry(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.tournamentsService.approveEntry(userId, tournamentId, entryId);
  }

  @Delete(':id/entries/:entryId')
  withdrawEntry(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.tournamentsService.withdrawEntry(userId, tournamentId, entryId);
  }

  @Post(':id/join')
  studentJoin(@UserId() userId: string, @Param('id') tournamentId: string) {
    return this.tournamentsService.studentJoinTournament(userId, tournamentId);
  }

  @Post(':id/start-attempt')
  startAttempt(@UserId() userId: string, @Param('id') tournamentId: string) {
    return this.tournamentsService.startAttempt(userId, tournamentId);
  }

  @Post(':id/submit-answer')
  submitAnswer(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Body() dto: SubmitTournamentAnswerDto,
  ) {
    return this.tournamentsService.submitAnswer(userId, tournamentId, dto);
  }

  @Post(':id/anti-cheat')
  reportAntiCheat(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Body() dto: ReportAntiCheatEventDto,
  ) {
    return this.tournamentsService.reportAntiCheatEvent(userId, tournamentId, dto);
  }

  @Post(':id/cheer')
  sendCheer(
    @UserId() userId: string,
    @Param('id') tournamentId: string,
    @Body() dto: SendSpectatorCheerDto,
  ) {
    return this.tournamentsService.sendSpectatorCheer(userId, tournamentId, dto);
  }
}
