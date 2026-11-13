import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AttendanceService,
  RollCallEntryInput,
} from './attendance.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TeacherClassScopeGuard } from '../../common/guards/teacher-class-scope.guard.js';

@Controller(['attendance', 'api/attendance'])
@UseGuards(RolesGuard, TeacherClassScopeGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * GET /attendance/subjects/:subjectId/summary
   * Full attendance summary, active PIN state, and student eligibility roster for a subject
   */
  @Get('subjects/:subjectId/summary')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN', 'STUDENT')
  getSummary(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Query('threshold') threshold?: string,
    @Query('date') date?: string,
    @Query('termId') termId?: string,
  ) {
    return this.attendanceService.getSubjectAttendanceSummary(
      subjectId,
      threshold ? Number(threshold) : undefined,
      userId,
      date,
      termId,
    );
  }

  /**
   * GET /attendance/subjects/:subjectId/sessions/:sessionId/detail
   * Daily roll-call register + CSV export for a specific date/session
   */
  @Get('subjects/:subjectId/sessions/:sessionId/detail')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getDailySessionDetail(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.attendanceService.getDailySessionDetail(
      userId,
      subjectId,
      sessionId,
    );
  }

  /**
   * GET /attendance/subjects/:subjectId/report
   * Term / Session register matrix + CSV export
   */
  @Get('subjects/:subjectId/report')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getTermReport(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Query('termId') termId?: string,
  ) {
    return this.attendanceService.getTermAttendanceReport(
      userId,
      subjectId,
      termId,
    );
  }

  /**
   * GET /attendance/subjects/:subjectId/students/:studentId
   * Particular student's attendance breakdown & chronological log + CSV export
   */
  @Get('subjects/:subjectId/students/:studentId')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getStudentDetail(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.attendanceService.getStudentAttendanceDetail(
      userId,
      subjectId,
      studentId,
    );
  }

  /**
   * PATCH /attendance/subjects/:subjectId/threshold
   * Update minimum required attendance percentage for exam eligibility
   */
  @Patch('subjects/:subjectId/threshold')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ATTENDANCE_THRESHOLD_UPDATED', 'SchoolSubject')
  updateThreshold(
    @UserId() userId: string,
    @Param('subjectId') subjectId: string,
    @Body() body: { minAttendancePercent: number },
  ) {
    return this.attendanceService.updateSubjectThreshold(
      userId,
      subjectId,
      body.minAttendancePercent,
    );
  }

  /**
   * POST /attendance/sessions/pin
   * Generate a 5-minute 4-digit Lecture PIN for student classroom check-in
   */
  @Post('sessions/pin')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('LECTURE_PIN_GENERATED', 'AttendanceSession')
  generateLecturePin(
    @UserId() userId: string,
    @Body()
    body: {
      subjectId: string;
      durationMinutes?: number;
      sessionId?: string;
    },
  ) {
    return this.attendanceService.generateLecturePin(userId, body);
  }

  /**
   * POST /attendance/sessions/roll-call
   * Teacher 1-tap bulk roll-call logging for an AttendanceSession
   */
  @Post('sessions/roll-call')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ATTENDANCE_ROLL_CALL_RECORDED', 'AttendanceSession')
  recordRollCall(
    @UserId() userId: string,
    @Body()
    body: {
      subjectId: string;
      sessionId?: string;
      sessionDate?: string;
      startNewSession?: boolean;
      records: RollCallEntryInput[];
    },
  ) {
    return this.attendanceService.recordRollCall(userId, body);
  }

  /**
   * POST /attendance/check-in
   * Student checks in to an active lecture session using the 4-digit PIN
   */
  @Post('check-in')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('STUDENT_PIN_CHECKIN', 'AttendanceRecord')
  studentCheckIn(
    @UserId() userId: string,
    @Body() body: { pinCode: string; subjectId?: string },
  ) {
    return this.attendanceService.studentPinCheckIn(userId, body);
  }

  /**
   * GET /attendance/student/me
   * Student attendance overview across all enrolled subjects + active class PINs
   */
  @Get('student/me')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getStudentOverview(@UserId() userId: string) {
    return this.attendanceService.getStudentAttendanceOverview(userId);
  }
}
