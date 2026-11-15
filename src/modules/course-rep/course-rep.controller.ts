import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CourseRepService } from './course-rep.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';

@Controller(['course-rep', 'api/course-rep'])
export class CourseRepController {
  constructor(private readonly courseRepService: CourseRepService) {}

  @Get('dashboard')
  getDashboard(@UserId() userId: string) {
    return this.courseRepService.getDashboard(userId);
  }

  @Get('delegates')
  listDelegates(
    @UserId() actorId: string,
    @Query('classId') classId?: string,
  ) {
    return this.courseRepService.listDelegates(actorId, classId);
  }

  @Post('assign')
  @AuditAction('ASSIGN_COURSE_REP', 'CourseRepAssignment')
  assignCourseRep(
    @UserId() actorId: string,
    @Body()
    dto: {
      studentId: string;
      classId?: string;
      subjectId?: string;
      title?: string;
      canBroadcastVenue?: boolean;
      canDistributeSlides?: boolean;
      canGenerateAttendanceSlips?: boolean;
      expiresAt?: string;
    },
  ) {
    return this.courseRepService.assignCourseRep(actorId, dto);
  }

  @Delete('assign/:assignmentId')
  @AuditAction('REVOKE_COURSE_REP', 'CourseRepAssignment')
  revokeCourseRep(
    @UserId() actorId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.courseRepService.revokeCourseRep(actorId, assignmentId);
  }

  @Post('broadcast')
  @AuditAction('COURSE_REP_BROADCAST', 'CourseRepBroadcast')
  createBroadcast(
    @UserId() userId: string,
    @Body()
    dto: {
      classId: string;
      subjectId?: string;
      title: string;
      message: string;
      venue?: string;
      scheduledTime?: string;
      urgency?: 'NORMAL' | 'URGENT' | 'CANCELLED';
    },
  ) {
    return this.courseRepService.createBroadcast(userId, dto);
  }

  @Post('distribute-slide')
  @AuditAction('COURSE_REP_SLIDE_DISTRIBUTION', 'MarketplaceItem')
  distributeSlide(
    @UserId() userId: string,
    @Body()
    dto: {
      classId: string;
      subjectId?: string;
      courseCode?: string;
      title: string;
      description?: string;
      fileBase64?: string;
      fileName?: string;
      fileUrl?: string;
      fileSize?: number;
    },
  ) {
    return this.courseRepService.distributeLectureSlide(userId, dto);
  }

  @Post('attendance-slip')
  @AuditAction('GENERATE_ATTENDANCE_SLIP', 'CourseRepAttendanceSlip')
  generateAttendanceSlip(
    @UserId() userId: string,
    @Body()
    dto: {
      classId: string;
      subjectId?: string;
      courseCode?: string;
      courseTitle?: string;
      venue?: string;
      validMinutes?: number;
    },
  ) {
    return this.courseRepService.generateAttendanceSlip(userId, dto);
  }

  @Post('attendance-slip/:slipCode/sign')
  signAttendanceSlip(
    @UserId() userId: string,
    @Param('slipCode') slipCode: string,
  ) {
    return this.courseRepService.signAttendanceSlip(userId, slipCode);
  }
}
