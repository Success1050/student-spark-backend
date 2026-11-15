import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InstitutionType } from '@prisma/client';
import { PastQuestionsService } from './past-questions.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';

@Controller(['past-questions', 'api/past-questions'])
export class PastQuestionsController {
  constructor(private readonly pastQuestionsService: PastQuestionsService) {}

  @Get('practice-sets')
  findPracticeSets(@UserId() userId: string) {
    return this.pastQuestionsService.findPracticeSetsByUser(userId);
  }

  @Get('practice-sets/:id')
  findOnePracticeSet(
    @Param('id') id: string,
    @UserId() userId?: string,
  ) {
    return this.pastQuestionsService.findOnePracticeSet(id, userId);
  }

  @Get('departmental')
  listDepartmentalPqs(
    @UserId() userId: string,
    @Query('schoolScope') schoolScope?: 'MY_SCHOOL' | 'ALL_UNIVERSITIES',
    @Query('departmentName') departmentName?: string,
    @Query('courseCode') courseCode?: string,
    @Query('levelCode') levelCode?: string,
    @Query('academicYear') academicYear?: string,
    @Query('semester') semester?: string,
    @Query('search') search?: string,
  ) {
    return this.pastQuestionsService.listDepartmentalPqs(userId, {
      schoolScope,
      departmentName,
      courseCode,
      levelCode,
      academicYear,
      semester,
      search,
    });
  }

  @Get('departmental/offline-bundle')
  getOfflinePqBundle(
    @UserId() userId: string,
    @Query('courseCode') courseCode?: string,
  ) {
    return this.pastQuestionsService.getOfflinePqBundle(userId, courseCode);
  }

  @Post('departmental')
  @AuditAction('UPLOAD_DEPARTMENTAL_PQ', 'DepartmentalPastQuestion')
  uploadDepartmentalPq(
    @UserId() userId: string,
    @Body()
    dto: {
      courseCode: string;
      courseTitle: string;
      departmentName?: string;
      facultyName?: string;
      levelCode?: string;
      academicYear: string;
      semester?: string;
      examType?: string;
      questionText?: string;
      fileBase64?: string;
      fileName?: string;
      fileUrl?: string;
      institutionType?: InstitutionType;
      isSharedPublicly?: boolean;
    },
  ) {
    return this.pastQuestionsService.uploadDepartmentalPq(userId, dto);
  }

  @Post('departmental/:id/solve')
  solveDepartmentalPq(
    @Param('id') id: string,
    @Body('forceRegenerate') forceRegenerate?: boolean,
  ) {
    return this.pastQuestionsService.solveDepartmentalPqWithAi(
      id,
      Boolean(forceRegenerate),
    );
  }

  @Post('departmental/:id/verify')
  verifyDepartmentalPq(
    @UserId() actorId: string,
    @Param('id') id: string,
  ) {
    return this.pastQuestionsService.verifyDepartmentalPq(actorId, id);
  }

  @Get()
  findAll(@UserId() userId: string) {
    return this.pastQuestionsService.findAllByUser(userId);
  }
}
