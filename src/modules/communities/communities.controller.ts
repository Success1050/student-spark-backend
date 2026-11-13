import { Controller, Get, Query } from '@nestjs/common';
import { CommunitiesService } from './communities.service.js';

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  list(@Query('schoolId') schoolId?: string) {
    return this.communitiesService.listStudentCommunities(schoolId);
  }
}
