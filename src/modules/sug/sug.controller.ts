import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SugService, type SugTier } from './sug.service.js';

@Controller(['sug', 'api/sug'])
@UseGuards(RolesGuard)
export class SugController {
  constructor(private readonly sugService: SugService) {}

  @Get('overview')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN')
  getOverview(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.sugService.getOverview(userId, schoolId);
  }

  @Get('candidates/students')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  listStudents(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.sugService.listCandidateStudents(userId, schoolId);
  }

  @Post('roles')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_ROLE_UPSERTED', 'SugRoleConfig')
  upsertRole(
    @UserId() userId: string,
    @Body()
    dto: {
      id?: string;
      schoolId?: string;
      title: string;
      tier?: SugTier;
      unitId?: string | null;
      departmentId?: string | null;
      description?: string;
      dueForElection?: boolean;
      isSelectionOpen?: boolean;
      eligibleLevels?: string[];
      maxEndorsementWinners?: number;
      canViewFinanceReadOnly?: boolean;
      canPostPublicUpdates?: boolean;
      canPostOpportunities?: boolean;
      canManageWelfare?: boolean;
      canManageElections?: boolean;
      canPostInternal?: boolean;
      maxHolders?: number;
    },
  ) {
    return this.sugService.upsertRoleConfig(userId, dto);
  }

  @Post('holders')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_HOLDER_APPOINTED', 'SugOfficeHolder')
  appointHolder(
    @UserId() userId: string,
    @Body()
    dto: {
      schoolId?: string;
      roleId: string;
      targetUserId: string;
      unitId?: string | null;
      departmentId?: string | null;
      classId?: string | null;
      tenureLabel?: string;
      manifestoOrBio?: string;
      photoBase64?: string;
      photoUrl?: string;
    },
  ) {
    return this.sugService.appointOfficeHolder(userId, dto);
  }

  @Delete('holders/:holderId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_HOLDER_REMOVED', 'SugOfficeHolder')
  removeHolder(
    @UserId() userId: string,
    @Param('holderId') holderId: string,
  ) {
    return this.sugService.removeOfficeHolder(userId, holderId);
  }

  @Post('endorsements/open')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_SELECTION_CALL_OPENED', 'SugRoleConfig')
  openSelectionCall(
    @UserId() userId: string,
    @Body()
    dto: {
      schoolId?: string;
      roleId: string;
      eligibleLevels?: string[];
      unitId?: string | null;
      departmentId?: string | null;
      announcementNote?: string;
      isOpen?: boolean;
    },
  ) {
    return this.sugService.openRoleSelectionCall(userId, dto);
  }

  @Post('endorsements/nominate')
  @Roles('STUDENT')
  @AuditAction('SUG_PEER_ENDORSED', 'SugEndorsementNominee')
  endorsePeer(
    @UserId() userId: string,
    @Body()
    dto: {
      roleId: string;
      nomineeUserId: string;
      manifesto?: string;
    },
  ) {
    return this.sugService.endorseOrNominatePeer(userId, dto);
  }

  @Post('endorsements/approve')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_ENDORSED_APPROVED', 'SugElection')
  approveEndorsed(
    @UserId() userId: string,
    @Body()
    dto: {
      roleId: string;
      nomineeIds?: string[];
      launchLiveNow?: boolean;
      electionTitle?: string;
    },
  ) {
    return this.sugService.approveEndorsedCandidatesAndLaunchElection(userId, dto);
  }

  @Post('elections')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_ELECTION_CREATED', 'SugElection')
  createElection(
    @UserId() userId: string,
    @Body()
    dto: {
      schoolId?: string;
      roleId: string;
      title?: string;
      description?: string;
      unitId?: string | null;
      departmentId?: string | null;
      status?: 'UPCOMING' | 'LIVE' | 'CLOSED';
      endsAt?: string | null;
    },
  ) {
    return this.sugService.createElection(userId, dto);
  }

  @Patch('elections/:electionId/status')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_ELECTION_STATUS_UPDATED', 'SugElection')
  updateElectionStatus(
    @UserId() userId: string,
    @Param('electionId') electionId: string,
    @Body('status') status: 'UPCOMING' | 'LIVE' | 'CLOSED',
  ) {
    return this.sugService.updateElectionStatus(userId, electionId, status);
  }

  @Post('elections/:electionId/candidates')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_ELECTION_CANDIDATE_ADDED', 'SugElectionCandidate')
  addCandidate(
    @UserId() userId: string,
    @Param('electionId') electionId: string,
    @Body()
    dto: {
      studentId?: string;
      fullName?: string;
      departmentName?: string;
      facultyName?: string;
      levelCode?: string;
      manifesto?: string;
      photoBase64?: string;
      photoUrl?: string;
    },
  ) {
    return this.sugService.addElectionCandidate(userId, electionId, dto);
  }

  @Post('elections/:electionId/vote')
  @Roles('STUDENT')
  @AuditAction('SUG_ELECTION_VOTE_CAST', 'SugElectionVote')
  castVote(
    @UserId() userId: string,
    @Param('electionId') electionId: string,
    @Body('candidateId') candidateId: string,
  ) {
    return this.sugService.castVote(userId, electionId, candidateId);
  }

  @Post('posts')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUG_POST_CREATED', 'SugPost')
  createPost(
    @UserId() userId: string,
    @Body()
    dto: {
      schoolId?: string;
      category?: string;
      title: string;
      body: string;
      amountOrStipend?: string;
      deadline?: string;
      externalLink?: string;
      isInternalOnly?: boolean;
      isNationwidePublic?: boolean;
      isPinned?: boolean;
    },
  ) {
    return this.sugService.createPost(userId, dto);
  }

  @Post('welfare')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  submitWelfare(
    @UserId() userId: string,
    @Body()
    dto: {
      schoolId?: string;
      category?: string;
      title: string;
      description: string;
      isPublicSummary?: boolean;
    },
  ) {
    return this.sugService.submitWelfareTicket(userId, dto);
  }

  @Patch('welfare/:ticketId')
  @Roles('STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  updateWelfare(
    @UserId() userId: string,
    @Param('ticketId') ticketId: string,
    @Body()
    dto: {
      status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
      resolutionNote?: string;
    },
  ) {
    return this.sugService.updateWelfareTicket(userId, ticketId, dto);
  }

  @Get('messages/:peerUserId')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getConversation(
    @UserId() userId: string,
    @Param('peerUserId') peerUserId: string,
  ) {
    return this.sugService.getConversation(userId, peerUserId);
  }

  @Post('messages/:peerUserId')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  sendMessage(
    @UserId() userId: string,
    @Param('peerUserId') peerUserId: string,
    @Body() dto: { message: string; isNationwide?: boolean },
  ) {
    return this.sugService.sendMessage(userId, peerUserId, dto);
  }

  @Get('nationwide')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getNationwide(@UserId() userId: string) {
    return this.sugService.getNationwideDirectory(userId);
  }
}
