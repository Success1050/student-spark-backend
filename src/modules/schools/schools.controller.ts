import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolsService } from './schools.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';

@Controller(['schools', 'api/schools'])
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Public()
  @Get('lookup/:code')
  lookupSchool(@Param('code') code: string) {
    return this.schoolsService.lookupSchool(code);
  }

  @Public()
  @Get(':schoolId/terminology')
  getSchoolTerminology(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getSchoolTerminology(schoolId);
  }

  @Get(':schoolId/dashboard')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN', 'SCHOOL_FINANCE')
  @UseGuards(TenantGuard, RolesGuard)
  getDashboard(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getSchoolPortalDashboard(schoolId);
  }

  @Post(':schoolId/reveal-secret')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('REVEAL_INSTITUTION_SECRET', 'School')
  revealMasterSecret(
    @Param('schoolId') schoolId: string,
    @UserId() userId: string,
    @Body('adminPassword') adminPassword: string,
  ) {
    return this.schoolsService.revealMasterSecret(schoolId, userId, adminPassword);
  }

  // ============================================================================
  // HIERARCHY ENGINE
  // ============================================================================

  @Get(':schoolId/hierarchy')
  @UseGuards(TenantGuard)
  getHierarchy(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getSchoolHierarchy(schoolId);
  }

  @Post(':schoolId/hierarchy/academic-unit')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_ACADEMIC_UNIT', 'AcademicUnit')
  createAcademicUnit(
    @Param('schoolId') schoolId: string,
    @Body() dto: { name: string; code: string; unitType?: string; description?: string },
  ) {
    return this.schoolsService.createAcademicUnit(schoolId, dto);
  }

  @Patch(':schoolId/hierarchy/academic-unit/:unitId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_ACADEMIC_UNIT', 'AcademicUnit')
  updateAcademicUnit(
    @Param('schoolId') schoolId: string,
    @Param('unitId') unitId: string,
    @Body() dto: { name?: string; code?: string; unitType?: string; description?: string },
  ) {
    return this.schoolsService.updateAcademicUnit(schoolId, unitId, dto);
  }

  @Delete(':schoolId/hierarchy/academic-unit/:unitId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('DELETE_ACADEMIC_UNIT', 'AcademicUnit')
  deleteAcademicUnit(
    @Param('schoolId') schoolId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.schoolsService.deleteAcademicUnit(schoolId, unitId);
  }

  @Post(':schoolId/hierarchy/department')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_DEPARTMENT', 'Department')
  createDepartment(
    @Param('schoolId') schoolId: string,
    @Body() dto: { name: string; code: string; unitId?: string },
  ) {
    return this.schoolsService.createDepartment(schoolId, dto);
  }

  @Patch(':schoolId/hierarchy/department/:deptId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_DEPARTMENT', 'Department')
  updateDepartment(
    @Param('schoolId') schoolId: string,
    @Param('deptId') deptId: string,
    @Body() dto: { name?: string; code?: string; unitId?: string | null },
  ) {
    return this.schoolsService.updateDepartment(schoolId, deptId, dto);
  }

  @Delete(':schoolId/hierarchy/department/:deptId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('DELETE_DEPARTMENT', 'Department')
  deleteDepartment(
    @Param('schoolId') schoolId: string,
    @Param('deptId') deptId: string,
  ) {
    return this.schoolsService.deleteDepartment(schoolId, deptId);
  }

  @Post(':schoolId/hierarchy/class')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_CLASS', 'SchoolClass')
  createSchoolClass(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      name: string;
      levelCode?: string;
      departmentId?: string;
      termOrSemester?: string;
      subjects?: Array<{
        name: string;
        courseCode?: string;
        creditUnits?: number | null;
        departmentId?: string;
      }>;
    },
  ) {
    return this.schoolsService.createSchoolClass(schoolId, dto);
  }

  @Get(':schoolId/hierarchy/class/:classId/details')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @UseGuards(TenantGuard, RolesGuard)
  getSchoolClassDetails(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
  ) {
    return this.schoolsService.getSchoolClassDetails(schoolId, classId);
  }

  @Patch(':schoolId/hierarchy/class/:classId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_CLASS', 'SchoolClass')
  updateSchoolClass(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
    @Body()
    dto: {
      name?: string;
      levelCode?: string;
      departmentId?: string | null;
      termOrSemester?: string;
    },
  ) {
    return this.schoolsService.updateSchoolClass(schoolId, classId, dto);
  }

  @Delete(':schoolId/hierarchy/class/:classId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('DELETE_CLASS', 'SchoolClass')
  deleteSchoolClass(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
  ) {
    return this.schoolsService.deleteSchoolClass(schoolId, classId);
  }

  @Post(':schoolId/hierarchy/class/:classId/subjects')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('ASSIGN_CLASS_SUBJECTS', 'SchoolClass')
  assignSubjectsToClass(
    @Param('schoolId') schoolId: string,
    @Param('classId') classId: string,
    @Body()
    dto: {
      subjects: Array<{
        name: string;
        courseCode?: string;
        creditUnits?: number | null;
        departmentId?: string;
        minAttendancePercent?: number;
      }>;
    },
  ) {
    return this.schoolsService.assignSubjectsToClass(schoolId, classId, dto);
  }

  @Post(':schoolId/hierarchy/subject')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_SUBJECT', 'SchoolSubject')
  createSchoolSubject(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      name: string;
      courseCode?: string;
      creditUnits?: number | null;
      classId?: string;
      classIds?: string[];
      departmentId?: string;
      minAttendancePercent?: number;
    },
  ) {
    return this.schoolsService.createSchoolSubject(schoolId, dto);
  }

  @Patch(':schoolId/hierarchy/subject/:subjectId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_SUBJECT', 'SchoolSubject')
  updateSchoolSubject(
    @Param('schoolId') schoolId: string,
    @Param('subjectId') subjectId: string,
    @Body()
    dto: {
      name?: string;
      courseCode?: string;
      creditUnits?: number | null;
      classId?: string;
      departmentId?: string | null;
      minAttendancePercent?: number;
    },
  ) {
    return this.schoolsService.updateSchoolSubject(schoolId, subjectId, dto);
  }

  @Delete(':schoolId/hierarchy/subject/:subjectId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('DELETE_SUBJECT', 'SchoolSubject')
  deleteSchoolSubject(
    @Param('schoolId') schoolId: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.schoolsService.deleteSchoolSubject(schoolId, subjectId);
  }

  // ============================================================================
  // STAFF & TEACHER PROVISIONING
  // ============================================================================

  @Get(':schoolId/staff')
  @UseGuards(TenantGuard)
  getStaff(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getSchoolStaff(schoolId);
  }

  @Get(':schoolId/staff/:staffId')
  @UseGuards(TenantGuard)
  getStaffDetails(
    @Param('schoolId') schoolId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.schoolsService.getSchoolStaffDetails(schoolId, staffId);
  }

  @Post(':schoolId/staff')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_STAFF', 'TeacherProfile')
  createStaff(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      fullName: string;
      staffId?: string;
      role?: string;
      email?: string;
      title?: string;
      departmentId?: string;
      specialization?: string;
      educationLevel?: string;
      qualificationDetails?: string;
      phoneNumber?: string;
      gender?: string;
      address?: string;
      employmentType?: string;
      yearsOfExperience?: number | string | null;
      dateHired?: string;
      handlesAllSubjects?: boolean;
      formClassIds?: string[];
      assignedClassIds?: string[];
      assignedSubjectIds?: string[];
    },
  ) {
    return this.schoolsService.createSchoolStaff(schoolId, dto);
  }

  @Patch(':schoolId/staff/:staffId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_STAFF', 'TeacherProfile')
  updateStaff(
    @Param('schoolId') schoolId: string,
    @Param('staffId') staffId: string,
    @Body()
    dto: {
      fullName?: string;
      email?: string;
      title?: string;
      departmentId?: string | null;
      specialization?: string | null;
      educationLevel?: string | null;
      qualificationDetails?: string | null;
      phoneNumber?: string | null;
      gender?: string | null;
      address?: string | null;
      employmentType?: string | null;
      yearsOfExperience?: number | string | null;
      dateHired?: string | null;
      handlesAllSubjects?: boolean;
    },
  ) {
    return this.schoolsService.updateSchoolStaff(schoolId, staffId, dto);
  }

  @Post(':schoolId/staff/:staffId/assignments')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('ASSIGN_STAFF_COURSES', 'TeacherProfile')
  assignTeacherCourses(
    @Param('schoolId') schoolId: string,
    @Param('staffId') staffId: string,
    @Body()
    dto: {
      classIds?: string[];
      subjectIds?: string[];
      formClassIds?: string[];
      handlesAllSubjects?: boolean;
    },
  ) {
    return this.schoolsService.assignTeacherCourses(schoolId, staffId, dto);
  }

  // ============================================================================
  // STUDENT PROVISIONING & BULK CSV IMPORT
  // ============================================================================

  @Get(':schoolId/students')
  @UseGuards(TenantGuard)
  getStudents(
    @Param('schoolId') schoolId: string,
    @Query('departmentId') departmentId?: string,
    @Query('classId') classId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.schoolsService.getSchoolStudents(schoolId, {
      departmentId,
      classId,
      search,
      page,
      limit,
    });
  }

  @Post(':schoolId/students')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_STUDENT', 'StudentProfile')
  createStudent(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      fullName: string;
      matricOrAdmissionNo?: string;
      email?: string;
      departmentId?: string;
      classId?: string;
      level?: string;
      age?: number | string | null;
      guardianName?: string;
      guardianRelationship?: string;
      guardianEmail?: string;
      guardianPhone?: string;
    },
  ) {
    return this.schoolsService.createSchoolStudent(schoolId, dto);
  }

  @Patch(':schoolId/students/:studentProfileId')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_STUDENT', 'StudentProfile')
  updateStudent(
    @Param('schoolId') schoolId: string,
    @Param('studentProfileId') studentProfileId: string,
    @Body()
    dto: {
      fullName?: string;
      matricOrAdmissionNo?: string;
      email?: string;
      classId?: string | null;
      departmentId?: string | null;
      level?: string;
      age?: number | string | null;
      guardianName?: string | null;
      guardianRelationship?: string | null;
      guardianEmail?: string | null;
      guardianPhone?: string | null;
    },
  ) {
    return this.schoolsService.updateSchoolStudent(schoolId, studentProfileId, dto);
  }

  @Patch(':schoolId/students/:studentProfileId/assignment')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('ASSIGN_STUDENT_CLASS', 'StudentProfile')
  assignStudentClass(
    @Param('schoolId') schoolId: string,
    @Param('studentProfileId') studentProfileId: string,
    @Body()
    dto: {
      classId?: string | null;
      departmentId?: string | null;
      level?: string;
    },
  ) {
    return this.schoolsService.assignStudentClass(schoolId, studentProfileId, dto);
  }

  @Post(':schoolId/students/parse-import-file')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  parseStudentImportFile(
    @Param('schoolId') schoolId: string,
    @UploadedFile() file?: { buffer?: Buffer; originalname?: string; mimetype?: string },
    @Body()
    body?: {
      fileBase64?: string;
      fileName?: string;
      mimeType?: string;
      rawText?: string;
    },
  ) {
    return this.schoolsService.parseStudentImportFile(schoolId, file, body);
  }

  @Post(':schoolId/students/bulk-import')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('BULK_IMPORT_STUDENTS', 'StudentProfile')
  bulkImportStudents(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      students: Array<{
        fullName: string;
        matricOrAdmissionNo: string;
        email?: string;
        departmentId?: string;
        departmentCode?: string;
        classId?: string;
        className?: string;
        level?: string;
      }>;
    },
  ) {
    return this.schoolsService.bulkImportStudents(schoolId, dto);
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  @Patch(':schoolId/settings')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_SCHOOL_SETTINGS', 'School')
  updateSettings(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      name?: string;
      logoUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      address?: string;
      contactEmail?: string;
      contactPhone?: string;
      terminologyConfig?: any;
    },
  ) {
    return this.schoolsService.updateSchoolSettings(schoolId, dto);
  }

  // ============================================================================
  // DAY 15B: SUG FAST ONBOARDING & STRIKE-PROOF CONTINUITY MODE
  // ============================================================================

  @Public()
  @Get('sug/lookup/:code')
  lookupSugCampaign(@Param('code') code: string) {
    return this.schoolsService.lookupSugCampaign(code);
  }

  @Public()
  @Post('sug/fast-onboard')
  fastOnboardViaSug(
    @Body()
    dto: {
      code: string;
      fullName: string;
      email: string;
      matricNo?: string;
      password: string;
      departmentId?: string;
      classId?: string;
      level?: string;
    },
  ) {
    return this.schoolsService.fastOnboardViaSug(dto);
  }

  @Get(':schoolId/sug/campaigns')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @UseGuards(TenantGuard, RolesGuard)
  listSugCampaigns(@Param('schoolId') schoolId: string) {
    return this.schoolsService.listSugCampaigns(schoolId);
  }

  @Post(':schoolId/sug/campaigns')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_SUG_CAMPAIGN', 'SugOnboardingCampaign')
  createSugCampaign(
    @Param('schoolId') schoolId: string,
    @UserId() userId: string,
    @Body()
    dto: {
      associationName: string;
      code?: string;
      facultyName?: string;
      departmentId?: string;
      defaultClassId?: string;
      defaultLevel?: string;
      proTrialDays?: number;
      maxUses?: number | null;
      welcomeMessage?: string;
    },
  ) {
    return this.schoolsService.createSugCampaign(schoolId, userId, dto);
  }

  @Get(':schoolId/continuity-status')
  @UseGuards(TenantGuard)
  getContinuityStatus(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getContinuityStatus(schoolId);
  }

  @Patch(':schoolId/continuity-status')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('UPDATE_CONTINUITY_STATUS', 'School')
  updateContinuityStatus(
    @Param('schoolId') schoolId: string,
    @Body()
    dto: {
      mode: 'ACTIVE' | 'STRIKE_BREAK';
      noticeTitle?: string;
      noticeBody?: string;
    },
  ) {
    return this.schoolsService.updateContinuityStatus(schoolId, dto);
  }
}
