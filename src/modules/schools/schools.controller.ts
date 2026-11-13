import {
  Body,
  Controller,
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

  @Post(':schoolId/hierarchy/class')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('CREATE_CLASS', 'SchoolClass')
  createSchoolClass(
    @Param('schoolId') schoolId: string,
    @Body() dto: { name: string; levelCode?: string; departmentId?: string; termOrSemester?: string },
  ) {
    return this.schoolsService.createSchoolClass(schoolId, dto);
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
      courseCode: string;
      creditUnits?: number;
      classId: string;
      departmentId?: string;
      minAttendancePercent?: number;
    },
  ) {
    return this.schoolsService.createSchoolSubject(schoolId, dto);
  }

  // ============================================================================
  // STAFF & TEACHER PROVISIONING
  // ============================================================================

  @Get(':schoolId/staff')
  getStaff(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getSchoolStaff(schoolId);
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
      staffId: string;
      email?: string;
      title?: string;
      departmentId?: string;
      specialization?: string;
      assignedClassIds?: string[];
      assignedSubjectIds?: string[];
    },
  ) {
    return this.schoolsService.createSchoolStaff(schoolId, dto);
  }

  @Post(':schoolId/staff/:staffId/assignments')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @AuditAction('ASSIGN_STAFF_COURSES', 'TeacherProfile')
  assignTeacherCourses(
    @Param('schoolId') schoolId: string,
    @Param('staffId') staffId: string,
    @Body() dto: { classIds?: string[]; subjectIds?: string[] },
  ) {
    return this.schoolsService.assignTeacherCourses(schoolId, staffId, dto);
  }

  // ============================================================================
  // STUDENT PROVISIONING & BULK CSV IMPORT
  // ============================================================================

  @Get(':schoolId/students')
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
      matricOrAdmissionNo: string;
      email?: string;
      departmentId?: string;
      classId?: string;
      level?: string;
    },
  ) {
    return this.schoolsService.createSchoolStudent(schoolId, dto);
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
}
