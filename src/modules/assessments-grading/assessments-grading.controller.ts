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
import { AssessmentsGradingService } from './assessments-grading.service.js';
import type {
  SaveGradeEntryInput,
  UpsertConfigInput,
} from './assessments-grading.service.js';
import { LiveRankingsService } from './live-rankings.service.js';
import type { LiveRankingScope } from './live-rankings.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TeacherClassScopeGuard } from '../../common/guards/teacher-class-scope.guard.js';

@Controller(['assessments-grading', 'api/assessments-grading'])
@UseGuards(RolesGuard, TeacherClassScopeGuard)
export class AssessmentsGradingController {
  constructor(
    private readonly gradingService: AssessmentsGradingService,
    private readonly liveRankingsService: LiveRankingsService,
  ) {}

  @Get('schools/:schoolId/live-rankings')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getLiveRankings(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Query('scope') scope?: LiveRankingScope,
    @Query('termId') termId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('classId') classId?: string,
    @Query('combinedKey') combinedKey?: string,
    @Query('subjectId') subjectId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('unitId') unitId?: string,
    @Query('metricMode') metricMode?: 'SEMESTER_GPA' | 'CUMULATIVE_CGPA',
    @Query('levelCode') levelCode?: string,
  ) {
    return this.liveRankingsService.getLiveRankings(userId, schoolId, {
      scope,
      termId,
      sessionId,
      classId,
      combinedKey,
      subjectId,
      departmentId,
      unitId,
      metricMode,
      levelCode,
    });
  }

  @Get('schools/:schoolId/terms')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN', 'STUDENT')
  getSchoolTerms(@Param('schoolId') schoolId: string) {
    return this.gradingService.ensureDefaultTerms(schoolId);
  }

  @Get('schools/:schoolId/analytics')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER')
  getSessionTermAnalytics(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Query('sessionId') sessionId?: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.getSessionTermAnalytics(userId, schoolId, {
      sessionId,
      termId,
    });
  }

  @Post('schools/:schoolId/sessions')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACADEMIC_SESSION_CREATED', 'AcademicSession')
  createSchoolSession(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Body() body: { name: string; makeCurrent?: boolean; customTerms?: string[] },
  ) {
    return this.gradingService.createSchoolSession(userId, schoolId, body);
  }

  @Post('schools/:schoolId/sessions/:sessionId/terms')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACADEMIC_TERM_CREATED', 'AcademicTerm')
  createSchoolTerm(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { name: string; makeCurrent?: boolean },
  ) {
    return this.gradingService.createSchoolTerm(
      userId,
      schoolId,
      sessionId,
      body,
    );
  }

  @Patch('schools/:schoolId/terms/:termId/activate')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACADEMIC_TERM_ACTIVATED', 'AcademicTerm')
  activateSchoolTerm(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('termId') termId: string,
    @Body() body?: { closePreviousCurrent?: boolean },
  ) {
    return this.gradingService.setActiveTerm(
      userId,
      schoolId,
      termId,
      Boolean(body?.closePreviousCurrent),
    );
  }

  @Patch('schools/:schoolId/terms/:termId/status')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACADEMIC_TERM_STATUS_UPDATED', 'AcademicTerm')
  updateSchoolTermStatus(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('termId') termId: string,
    @Body() body: { isEnabled?: boolean; isClosed?: boolean },
  ) {
    return this.gradingService.updateTermStatus(userId, schoolId, termId, body);
  }

  @Get('schools/:schoolId/calendar')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getSchoolAcademicCalendar(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.getSchoolAcademicCalendar(
      userId,
      schoolId,
      termId,
    );
  }

  @Patch('schools/:schoolId/terms/:termId/dates')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACADEMIC_TERM_DATES_UPDATED', 'AcademicTerm')
  updateTermCalendarDates(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('termId') termId: string,
    @Body()
    body: {
      startDate?: string | null;
      endDate?: string | null;
      nextTermResumesDate?: string | null;
    },
  ) {
    return this.gradingService.updateTermCalendarDates(
      userId,
      schoolId,
      termId,
      body,
    );
  }

  @Post('schools/:schoolId/terms/:termId/calendar-events')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CALENDAR_EVENT_CREATED', 'SchoolCalendarEvent')
  createCalendarEvent(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('termId') termId: string,
    @Body()
    body: {
      title: string;
      type?: 'HOLIDAY' | 'MID_TERM' | 'OTHER';
      startDate: string;
      endDate?: string;
      description?: string;
    },
  ) {
    return this.gradingService.createCalendarEvent(
      userId,
      schoolId,
      termId,
      body,
    );
  }

  @Patch('schools/:schoolId/calendar-events/:eventId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CALENDAR_EVENT_UPDATED', 'SchoolCalendarEvent')
  updateCalendarEvent(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('eventId') eventId: string,
    @Body()
    body: {
      title?: string;
      type?: 'HOLIDAY' | 'MID_TERM' | 'OTHER';
      startDate?: string;
      endDate?: string;
      description?: string | null;
    },
  ) {
    return this.gradingService.updateCalendarEvent(
      userId,
      schoolId,
      eventId,
      body,
    );
  }

  @Delete('schools/:schoolId/calendar-events/:eventId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CALENDAR_EVENT_DELETED', 'SchoolCalendarEvent')
  deleteCalendarEvent(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.gradingService.deleteCalendarEvent(userId, schoolId, eventId);
  }

  @Get('schools/:schoolId/config')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getSchoolConfig(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
  ) {
    return this.gradingService.getSchoolAssessmentConfig(userId, schoolId);
  }

  @Patch('schools/:schoolId/config')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SCHOOL_ASSESSMENT_CONFIG_UPDATED', 'AssessmentConfig')
  updateSchoolConfig(
    @UserId() userId: string,
    @Param('schoolId') schoolId: string,
    @Body() body: UpsertConfigInput,
  ) {
    return this.gradingService.upsertSchoolAssessmentConfig(
      userId,
      schoolId,
      body,
    );
  }

  @Get('subjects/:subjectId/gradebook')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getSubjectGradebook(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.getSubjectGradebook(userId, subjectId, termId);
  }

  @Patch('subjects/:subjectId/config')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ASSESSMENT_CONFIG_UPDATED', 'AssessmentConfig')
  updateConfig(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Body() body: UpsertConfigInput,
  ) {
    return this.gradingService.upsertAssessmentConfig(userId, subjectId, body);
  }

  @Post('subjects/:subjectId/grades')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SUBJECT_GRADES_RECORDED', 'StudentSubjectGrade')
  saveSubjectGrades(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Body() body: { termId?: string; entries: SaveGradeEntryInput[] },
  ) {
    return this.gradingService.saveSubjectGrades(userId, subjectId, body);
  }

  @Post('subjects/:subjectId/import-cbt')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CBT_SCORES_IMPORTED_TO_GRADEBOOK', 'StudentSubjectGrade')
  importCbtScores(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Body()
    body: { quizId: string; targetComponentKey?: string; termId?: string },
  ) {
    return this.gradingService.importCbtScoresToGradebook(
      userId,
      subjectId,
      body,
    );
  }

  @Get('classes/:classId/broadsheet')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getBroadsheet(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.computeClassBroadsheetAndPositions(
      classId,
      termId,
      userId,
    );
  }

  @Post('classes/:classId/publish')
  @Roles('SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN')
  @AuditAction('CLASS_RESULTS_PUBLISHED', 'TerminalReportCard')
  publishResults(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Body() body: { termId?: string; published: boolean },
  ) {
    return this.gradingService.publishClassResults(userId, classId, body);
  }

  @Post('classes/:classId/students/:studentId/draft-remarks')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  draftStudentRemarks(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Body()
    body: {
      termId?: string;
      tone?: 'ENCOURAGING' | 'FORMAL' | 'CONSTRUCTIVE';
      saveImmediately?: boolean;
    },
  ) {
    return this.gradingService.draftStudentReportCardRemarks(
      userId,
      classId,
      studentId,
      body || {},
    );
  }

  @Patch('classes/:classId/students/:studentId/remarks')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('REPORT_CARD_REMARKS_UPDATED', 'TerminalReportCard')
  updateStudentRemarks(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Body()
    body: {
      termId?: string;
      teacherRemark?: string | null;
      principalRemark?: string | null;
    },
  ) {
    return this.gradingService.updateStudentReportCardRemarks(
      userId,
      classId,
      studentId,
      body,
    );
  }

  @Post('classes/:classId/draft-all-remarks')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('BULK_AI_REMARKS_DRAFTED', 'TerminalReportCard')
  draftAllClassRemarks(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Body()
    body: {
      termId?: string;
      overwriteExisting?: boolean;
      tone?: 'ENCOURAGING' | 'FORMAL' | 'CONSTRUCTIVE';
    },
  ) {
    return this.gradingService.draftAllMissingClassRemarks(
      userId,
      classId,
      body || {},
    );
  }

  @Get('classes/:classId/traits')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getClassTraits(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.getClassTraitRatings(userId, classId, termId);
  }

  @Patch('classes/:classId/students/:studentId/traits')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('STUDENT_TRAITS_UPDATED', 'TerminalReportCard')
  updateStudentTraits(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Body()
    body: {
      termId?: string;
      ratings: Record<string, string>;
      daysPresent?: number | null;
      daysLate?: number | null;
      daysAbsent?: number | null;
      daysExcused?: number | null;
      teacherRemark?: string | null;
    },
  ) {
    return this.gradingService.updateStudentTraitRatings(
      userId,
      classId,
      studentId,
      body,
    );
  }

  @Get('classes/:classId/students/:studentId/report-card')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getStudentClassReportCard(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.getStudentReportCardForClass(
      userId,
      classId,
      studentId,
      termId,
    );
  }

  @Get('student/my-grades')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getMyGrades(
    @UserId() userId: string,
    @Query('termId') termId?: string,
  ) {
    return this.gradingService.getStudentGradesSummary(userId, termId);
  }
}
