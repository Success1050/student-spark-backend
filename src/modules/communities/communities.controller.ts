import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { CommunitiesService } from './communities.service.js';
import {
  CreateChannelDto,
  CreateCommunityDto,
  JoinCommunityByCodeDto,
  SendChannelMessageDto,
  SendDmMessageDto,
  StartDmDto,
  ToggleReactionDto,
  UploadCommunityMediaDto,
} from './dto/communities.dto.js';

@Controller(['communities', 'api/communities'])
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get('hub')
  getHub(@UserId() userId: string, @Query('schoolId') schoolId?: string) {
    return this.communitiesService.getCommunitiesHub(userId, schoolId);
  }

  @Get()
  listCompat(@UserId() userId: string, @Query('schoolId') schoolId?: string) {
    return this.communitiesService.getCommunitiesHub(userId, schoolId);
  }

  @Post()
  createCommunity(
    @UserId() userId: string,
    @Body() dto: CreateCommunityDto,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.communitiesService.createCommunity(userId, dto, schoolId);
  }

  @Post(':communityId/channels')
  createChannel(
    @UserId() userId: string,
    @Param('communityId') communityId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.communitiesService.createChannel(userId, communityId, dto);
  }

  @Post(':communityId/join')
  joinCommunity(@UserId() userId: string, @Param('communityId') communityId: string) {
    return this.communitiesService.joinCommunity(userId, communityId);
  }

  @Post('join-code')
  joinByCode(@UserId() userId: string, @Body() dto: JoinCommunityByCodeDto) {
    return this.communitiesService.joinCommunityByInviteCode(userId, dto.inviteCode);
  }

  @Post(':communityId/leave')
  leaveCommunity(@UserId() userId: string, @Param('communityId') communityId: string) {
    return this.communitiesService.leaveCommunity(userId, communityId);
  }

  @Get('channels/:channelId/messages')
  getChannelMessages(
    @UserId() userId: string,
    @Param('channelId') channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.communitiesService.getChannelMessages(userId, channelId, {
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Post('channels/:channelId/messages')
  sendChannelMessage(
    @UserId() userId: string,
    @Param('channelId') channelId: string,
    @Body() dto: SendChannelMessageDto,
  ) {
    return this.communitiesService.sendChannelMessage(userId, channelId, dto);
  }

  @Post('messages/:messageId/react')
  toggleReaction(
    @UserId() userId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ToggleReactionDto,
  ) {
    return this.communitiesService.toggleMessageReaction(userId, messageId, dto.emoji);
  }

  @Post('messages/:messageId/pin')
  togglePin(@UserId() userId: string, @Param('messageId') messageId: string) {
    return this.communitiesService.togglePinMessage(userId, messageId);
  }

  @Delete('messages/:messageId')
  deleteMessage(@UserId() userId: string, @Param('messageId') messageId: string) {
    return this.communitiesService.deleteChannelMessage(userId, messageId);
  }

  // ---- Cross-School & Campus 1v1 DMs & Peer Discovery ----

  @Get('peers')
  discoverPeers(
    @UserId() userId: string,
    @Query('search') search?: string,
    @Query('scope') scope?: 'ALL' | 'MY_CAMPUS' | 'OTHER_SCHOOLS',
  ) {
    return this.communitiesService.discoverPeers(userId, { search, scope });
  }

  @Get('dms')
  listDms(@UserId() userId: string) {
    return this.communitiesService.listDmConversations(userId);
  }

  @Post('dms')
  startDm(@UserId() userId: string, @Body() dto: StartDmDto) {
    return this.communitiesService.startOrGetDm(userId, dto.recipientId);
  }

  @Get('dms/:conversationId/messages')
  getDmMessages(
    @UserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.communitiesService.getDmMessages(userId, conversationId, {
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Post('dms/:conversationId/messages')
  sendDmMessage(
    @UserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendDmMessageDto,
  ) {
    return this.communitiesService.sendDmMessage(userId, conversationId, dto);
  }

  @Post('upload-media')
  uploadMedia(@UserId() userId: string, @Body() dto: UploadCommunityMediaDto) {
    return this.communitiesService.uploadChatMedia(userId, dto);
  }

  @Get('shareable-notes')
  getShareableNotes(@UserId() userId: string) {
    return this.communitiesService.getShareableStudyNotes(userId);
  }
}
