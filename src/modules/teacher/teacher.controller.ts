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
import { TeacherService } from './teacher.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TeacherClassScopeGuard } from '../../common/guards/teacher-class-scope.guard.js';

@Controller(['teacher', 'api/teacher'])
@UseGuards(RolesGuard, TeacherClassScopeGuard)
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  /**
   * GET /teacher/dashboard
   */
  @Get('dashboard')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getDashboard(@UserId() userId: string) {
    return this.teacherService.getTeacherDashboard(userId);
  }

  /**
   * GET /teacher/profile
   */
  @Get('profile')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getProfile(@UserId() userId: string) {
    return this.teacherService.getTeacherProfile(userId);
  }

  /**
   * PATCH /teacher/profile
   */
  @Patch('profile')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('UPDATE_TEACHER_PROFILE', 'TeacherProfile')
  updateProfile(
    @UserId() userId: string,
    @Body()
    body: {
      title?: string;
      specialization?: string;
      fullName?: string;
    },
  ) {
    return this.teacherService.updateTeacherProfile(userId, body);
  }

  /**
   * GET /teacher/courses
   */
  @Get('courses')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getAssignedCourses(@UserId() userId: string) {
    return this.teacherService.getAssignedCourses(userId);
  }

  /**
   * GET /teacher/classes
   */
  @Get('classes')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getAssignedClasses(@UserId() userId: string) {
    return this.teacherService.getAssignedClasses(userId);
  }

  /**
   * GET /teacher/roster
   */
  @Get('roster')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getEnrolledRoster(
    @UserId() userId: string,
    @Query('subjectId') subjectId?: string,
    @Query('classId') classId?: string,
    @Query('search') search?: string,
  ) {
    return this.teacherService.getEnrolledRoster(userId, {
      subjectId,
      classId,
      search,
    });
  }

  /**
   * GET /teacher/roster/:studentId/record
   * Comprehensive sectioned & tabbed student academic record
   */
  @Get('roster/:studentId/record')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getStudentRecord(
    @UserId() userId: string,
    @Param('studentId') studentId: string,
    @Query('termId') termId?: string,
  ) {
    return this.teacherService.getStudentDetailedRecord(userId, studentId, termId);
  }

  /**
   * GET /teacher/notes
   */
  @Get('notes')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getTeacherNotes(
    @UserId() userId: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.teacherService.getTeacherNotes(userId, subjectId);
  }

  /**
   * POST /teacher/notes
   */
  @Post('notes')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CLASS_NOTE_DISTRIBUTED', 'Note')
  createTeacherNote(
    @UserId() userId: string,
    @Body()
    body: {
      title: string;
      summary?: string;
      courseCode: string;
      subjectId: string;
      classId: string;
      listsOfTopic?: string[];
      color?: string;
      fileUrl?: string;
      fileBase64?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      alsoPostToClassHandouts?: boolean;
    },
  ) {
    return this.teacherService.createTeacherNote(userId, body);
  }

  /**
   * POST /teacher/notes/generate
   */
  @Post('notes/generate')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CLASS_NOTE_GENERATED', 'Note')
  generateTeacherNoteDraft(
    @UserId() userId: string,
    @Body()
    body: {
      subjectId: string;
      topic: string;
      mode?: 'FULL_NOTE' | 'SUMMARIZE';
      sourceTextOrHints?: string;
    },
  ) {
    return this.teacherService.generateTeacherNoteDraft(userId, body);
  }

  /**
   * PATCH /teacher/notes/:id
   */
  @Patch('notes/:id')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CLASS_NOTE_UPDATED', 'Note')
  updateTeacherNote(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      summary?: string;
      listsOfTopic?: string[];
      alsoPostToClassHandouts?: boolean;
    },
  ) {
    return this.teacherService.updateTeacherNote(userId, id, body);
  }

  /**
   * DELETE /teacher/notes/:id
   */
  @Delete('notes/:id')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CLASS_NOTE_DELETED', 'Note')
  deleteTeacherNote(@UserId() userId: string, @Param('id') id: string) {
    return this.teacherService.deleteTeacherNote(userId, id);
  }

  /**
   * GET /teacher/cbt
   */
  @Get('cbt')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getTeacherCBTs(
    @UserId() userId: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.teacherService.getTeacherCBTs(userId, subjectId);
  }

  /**
   * POST /teacher/cbt/generate-questions
   * AI-generate CBT MCQs from uploaded note file (PDF/DOCX/TXT), existing course note, or pasted text
   */
  @Post('cbt/generate-questions')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  generateCBTQuestions(
    @UserId() userId: string,
    @Body()
    body: {
      subjectId: string;
      noteId?: string;
      noteText?: string;
      fileBase64?: string;
      fileName?: string;
      mimeType?: string;
      questionCount?: number;
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED';
      includeExplanations?: boolean;
    },
  ) {
    return this.teacherService.generateCbtQuestionsFromNote(userId, body);
  }

  /**
   * POST /teacher/cbt
   */
  @Post('cbt')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CBT_ASSESSMENT_PUBLISHED', 'Quiz')
  createTeacherCBT(
    @UserId() userId: string,
    @Body()
    body: {
      title: string;
      courseCode: string;
      subjectId: string;
      classId: string;
      timeLimitMinutes?: number;
      totalPossibleMarks?: number;
      dueDate?: string;
      questions: Array<{
        question: string;
        options: string[];
        correctAnswer: string | number;
        explanation?: string;
      }>;
    },
  ) {
    return this.teacherService.createTeacherCBT(userId, body);
  }

  /**
   * GET /teacher/cbt/:id/submissions
   */
  @Get('cbt/:id/submissions')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getCBTSubmissions(@UserId() userId: string, @Param('id') id: string) {
    return this.teacherService.getCBTSubmissions(userId, id);
  }

  /**
   * POST /teacher/cbt/:id/submit
   * Student endpoint to submit CBT score
   */
  @Post('cbt/:id/submit')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CBT_ASSESSMENT_SUBMITTED', 'CbtSubmission')
  submitCBT(
    @UserId() studentId: string,
    @Param('id') quizId: string,
    @Body()
    body: {
      score: number;
      percentage: number;
      totalMarks: number;
      totalPossibleMarks: number;
      answersJson?: any;
    },
  ) {
    return this.teacherService.submitCBT(studentId, quizId, body);
  }

  /**
   * GET /teacher/student/assessments
   * Student endpoint to fetch class notes and CBT quizzes
   */
  @Get('student/assessments')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  getStudentAssessments(@UserId() studentId: string) {
    return this.teacherService.getStudentAssessments(studentId);
  }
}
