import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import AdmZip from 'adm-zip';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';

export interface InstitutionTerminology {
  unitLabel: string;
  departmentLabel: string;
  levelLabel: string;
  courseLabel: string;
  educatorLabel: string;
  studentIdLabel: string;
  periodLabel: string;
  degreeOrCertificateLabel: string;
}

const DEFAULT_TERMINOLOGY: Record<string, InstitutionTerminology> = {
  UNIVERSITY: {
    unitLabel: 'Faculty / College',
    departmentLabel: 'Department',
    levelLabel: 'Level',
    courseLabel: 'Course',
    educatorLabel: 'Lecturer',
    studentIdLabel: 'Matriculation No',
    periodLabel: 'Semester',
    degreeOrCertificateLabel: 'Degree',
  },
  POLYTECHNIC: {
    unitLabel: 'School / Faculty',
    departmentLabel: 'Department',
    levelLabel: 'Programme & Level',
    courseLabel: 'Course',
    educatorLabel: 'Lecturer',
    studentIdLabel: 'Matriculation No',
    periodLabel: 'Semester',
    degreeOrCertificateLabel: 'Diploma / HND',
  },
  SECONDARY: {
    unitLabel: 'Section',
    departmentLabel: 'Department',
    levelLabel: 'Class & Arm',
    courseLabel: 'Subject',
    educatorLabel: 'Teacher',
    studentIdLabel: 'Admission No',
    periodLabel: 'Term',
    degreeOrCertificateLabel: 'Report Card',
  },
  OTHER: {
    unitLabel: 'Division',
    departmentLabel: 'Department',
    levelLabel: 'Cohort / Level',
    courseLabel: 'Module / Course',
    educatorLabel: 'Instructor',
    studentIdLabel: 'Student ID',
    periodLabel: 'Term',
    degreeOrCertificateLabel: 'Certificate',
  },
};

@Injectable()
export class SchoolsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve school by code or slug for public login UI preview
   */
  async lookupSchool(codeOrSlug: string) {
    const clean = codeOrSlug?.trim();
    if (!clean) throw new NotFoundException('School code or slug is required');

    const school = await this.prisma.school.findFirst({
      where: {
        OR: [
          { schoolCode: clean.toUpperCase() },
          { slug: clean.toLowerCase() },
          { id: clean },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        schoolCode: true,
        institutionType: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        terminologyConfig: true,
      },
    });

    if (!school) {
      throw new NotFoundException(`No institution found with code or handle "${clean}"`);
    }

    const type = school.institutionType || 'SECONDARY';
    const baseTerminology = DEFAULT_TERMINOLOGY[type] || DEFAULT_TERMINOLOGY.SECONDARY;
    const customConfig = { ...((school.terminologyConfig as any) || {}) };
    if (customConfig.departmentLabel === 'Stream / Track') {
      customConfig.departmentLabel = 'Department';
    }
    const finalTerminology = {
      ...baseTerminology,
      ...customConfig,
    };

    return {
      success: true,
      school: {
        ...school,
        terminology: finalTerminology,
      },
    };
  }

  /**
   * Get dynamic terminology for a specific school
   */
  async getSchoolTerminology(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        institutionType: true,
        terminologyConfig: true,
      },
    });

    const type = school?.institutionType || 'SECONDARY';
    const base = DEFAULT_TERMINOLOGY[type] || DEFAULT_TERMINOLOGY.SECONDARY;
    const custom = { ...((school?.terminologyConfig as any) || {}) };
    if (custom.departmentLabel === 'Stream / Track') {
      custom.departmentLabel = 'Department';
    }

    return {
      success: true,
      schoolId,
      institutionType: type,
      terminology: {
        ...base,
        ...custom,
      },
    };
  }

  async getSchoolPortalDashboard(schoolId: string) {
    const [school, unitsCount, departmentsCount, classesCount, teachersCount, studentsCount] =
      await Promise.all([
        this.prisma.school.findUnique({ where: { id: schoolId } }),
        this.prisma.academicUnit.count({ where: { schoolId } }),
        this.prisma.department.count({ where: { schoolId } }),
        this.prisma.schoolClass.count({ where: { schoolId } }),
        this.prisma.teacherProfile.count({ where: { schoolId } }),
        this.prisma.studentProfile.count({ where: { schoolId } }),
      ]);

    if (!school) throw new NotFoundException('School not found');

    const terminology = await this.getSchoolTerminology(schoolId);

    return {
      schoolId,
      schoolName: school.name,
      institutionType: school.institutionType,
      terminology: terminology.terminology,
      stats: {
        unitsCount,
        departmentsCount,
        classesCount,
        teachersCount,
        studentsCount,
      },
    };
  }

  async revealMasterSecret(schoolId: string, adminUserId: string, adminPassword?: string) {
    if (!adminPassword?.trim()) {
      throw new BadRequestException('Admin password is required to reveal the master secret key.');
    }

    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });
    if (!adminUser || !adminUser.passwordHash) {
      throw new UnauthorizedException('Admin user not found or unauthenticated.');
    }

    const isMatch = await bcrypt.compare(adminPassword, adminUser.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Incorrect admin password. Verification failed.');
    }

    let school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });
    if (!school) {
      throw new NotFoundException('Institution not found.');
    }

    // Auto-generate high-entropy master secret key if none exists yet
    if (!school.masterSecretKey) {
      const generatedKey = `SEC-SPK-${randomUUID().replace(/-/g, '').toUpperCase()}`;
      school = await this.prisma.school.update({
        where: { id: schoolId },
        data: {
          masterSecretKey: generatedKey,
          secretKeyCreatedAt: new Date(),
        },
      });
    }

    return {
      success: true,
      schoolId: school.id,
      schoolName: school.name,
      masterSecretKey: school.masterSecretKey,
      secretKeyCreatedAt: school.secretKeyCreatedAt,
    };
  }

  // ============================================================================
  // HIERARCHY ENGINE: ACADEMIC UNITS, DEPARTMENTS, CLASSES & SUBJECTS
  // ============================================================================

  async getSchoolHierarchy(schoolId: string) {
    const [units, unassignedDepartments, allClasses, allSubjects] = await Promise.all([
      this.prisma.academicUnit.findMany({
        where: { schoolId },
        include: {
          departments: {
            include: {
              classes: true,
              subjects: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { schoolId, unitId: null },
        include: {
          classes: true,
          subjects: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        include: {
          department: true,
          subjects: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.schoolSubject.findMany({
        where: { schoolId },
        include: {
          schoolClass: true,
          department: true,
          assignedTeachers: {
            include: { user: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      success: true,
      academicUnits: units,
      unassignedDepartments,
      allClasses,
      allSubjects,
    };
  }

  async createAcademicUnit(
    schoolId: string,
    dto: { name: string; code: string; unitType?: string; description?: string },
  ) {
    if (!dto.name?.trim() || !dto.code?.trim()) {
      throw new BadRequestException('Unit name and code are required.');
    }
    const cleanName = dto.name.trim();
    const cleanCode = dto.code.trim().toUpperCase();
    const existing = await this.prisma.academicUnit.findFirst({
      where: {
        schoolId,
        OR: [
          { code: cleanCode },
          { name: { equals: cleanName, mode: 'insensitive' } },
        ],
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Section / Faculty "${cleanName}" (or code "${cleanCode}") already exists in this institution.`,
      );
    }

    const unit = await this.prisma.academicUnit.create({
      data: {
        schoolId,
        name: cleanName,
        code: cleanCode,
        unitType: dto.unitType || 'FACULTY',
        description: dto.description?.trim(),
      },
    });

    return { success: true, academicUnit: unit };
  }

  async createDepartment(
    schoolId: string,
    dto: { name: string; code: string; unitId?: string },
  ) {
    if (!dto.name?.trim() || !dto.code?.trim()) {
      throw new BadRequestException('Department name and code are required.');
    }
    const cleanName = dto.name.trim();
    const cleanCode = dto.code.trim().toUpperCase();
    const existing = await this.prisma.department.findFirst({
      where: {
        schoolId,
        OR: [
          { code: cleanCode },
          { name: { equals: cleanName, mode: 'insensitive' } },
        ],
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Department "${cleanName}" (or code "${cleanCode}") already exists in this institution.`,
      );
    }

    const dept = await this.prisma.department.create({
      data: {
        schoolId,
        name: cleanName,
        code: cleanCode,
        unitId: dto.unitId || null,
      },
      include: { unit: true },
    });

    return { success: true, department: dept };
  }

  async createSchoolClass(
    schoolId: string,
    dto: { name: string; levelCode?: string; departmentId?: string; termOrSemester?: string },
  ) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Class/level name is required.');
    }
    const cleanName = dto.name.trim();
    const normalizeClassKey = (val: string) =>
      val.replace(/[\s\-_]+/g, '').toUpperCase();

    const targetKey = normalizeClassKey(cleanName);
    const existingClasses = await this.prisma.schoolClass.findMany({
      where: { schoolId },
      select: { id: true, name: true, departmentId: true },
    });

    const duplicate = existingClasses.find((c) => {
      const sameNormalizedName = normalizeClassKey(c.name) === targetKey;
      if (!sameNormalizedName) return false;
      // If a departmentId is specified on both and they differ (e.g. 100L CSC vs 100L EEE), allow only if departmentId differs
      if (dto.departmentId && c.departmentId && dto.departmentId !== c.departmentId) {
        return false;
      }
      return true;
    });

    if (duplicate) {
      throw new BadRequestException(
        `Class "${cleanName}" already exists. Same class cannot be created twice unless differentiated by arm letters (e.g. "${cleanName} A", "${cleanName} B", "${cleanName} C").`,
      );
    }

    const inviteCode = `CLS-${randomUUID().slice(0, 8).toUpperCase()}`;
    const schoolClass = await this.prisma.schoolClass.create({
      data: {
        schoolId,
        name: cleanName,
        levelCode: dto.levelCode?.trim(),
        departmentId: dto.departmentId || null,
        termOrSemester: dto.termOrSemester?.trim(),
        inviteCode,
      },
      include: { department: true },
    });

    return { success: true, schoolClass };
  }

  async createSchoolSubject(
    schoolId: string,
    dto: {
      name: string;
      courseCode: string;
      creditUnits?: number;
      classId: string;
      departmentId?: string;
      minAttendancePercent?: number;
    },
  ) {
    if (!dto.name?.trim() || !dto.courseCode?.trim() || !dto.classId) {
      throw new BadRequestException('Course name, course code, and target class are required.');
    }

    const cleanName = dto.name.trim();
    const cleanCode = dto.courseCode.trim().toUpperCase();

    const existingSubject = await this.prisma.schoolSubject.findFirst({
      where: {
        schoolId,
        classId: dto.classId,
        OR: [
          { name: { equals: cleanName, mode: 'insensitive' } },
          { courseCode: { equals: cleanCode, mode: 'insensitive' } },
        ],
      },
    });

    if (existingSubject) {
      throw new BadRequestException(
        `Subject / Course "${cleanName}" (${cleanCode}) is already registered for this class.`,
      );
    }

    const subject = await this.prisma.schoolSubject.create({
      data: {
        schoolId,
        classId: dto.classId,
        departmentId: dto.departmentId || null,
        name: cleanName,
        courseCode: cleanCode,
        creditUnits: dto.creditUnits ?? 3,
        minAttendancePercent: dto.minAttendancePercent ?? 75.0,
      },
      include: {
        schoolClass: true,
        department: true,
      },
    });

    return { success: true, subject };
  }

  // ============================================================================
  // STAFF & TEACHER PROVISIONING
  // ============================================================================

  async getSchoolStaff(schoolId: string) {
    const staff = await this.prisma.teacherProfile.findMany({
      where: { schoolId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
        department: true,
        assignedClasses: true,
        assignedSubjects: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, staff };
  }

  async createSchoolStaff(
    schoolId: string,
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
    if (!dto.fullName?.trim() || !dto.staffId?.trim()) {
      throw new BadRequestException('Full name and Staff ID are required.');
    }

    const cleanStaffId = dto.staffId.trim().toUpperCase();
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');

    const existingProfile = await this.prisma.teacherProfile.findFirst({
      where: { schoolId, staffId: cleanStaffId },
    });
    if (existingProfile) {
      throw new BadRequestException(`Staff ID "${cleanStaffId}" is already registered in this institution.`);
    }

    const safeSlug = (school.slug || 'school').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanId = cleanStaffId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const staffEmail = dto.email?.trim()?.toLowerCase() || `${cleanId}@${safeSlug}.spark`;

    const commonPassword = 'SparkPass2026!';
    const passwordHash = await bcrypt.hash(commonPassword, 10);

    let user = await this.prisma.user.findUnique({ where: { email: staffEmail } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: staffEmail,
          fullName: dto.fullName.trim(),
          passwordHash,
          role: 'TEACHER',
          schoolId,
          loginId: cleanStaffId,
          mustChangePassword: true,
          referralCode: `STF-${Math.floor(100000 + Math.random() * 900000)}`,
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: dto.fullName.trim(),
          role: 'TEACHER',
          schoolId,
          loginId: cleanStaffId,
          mustChangePassword: true,
        },
      });
    }

    let membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, schoolId },
    });
    if (!membership) {
      membership = await this.prisma.membership.create({
        data: {
          userId: user.id,
          schoolId,
          role: 'TEACHER',
          loginId: cleanStaffId,
          mustChangePassword: true,
          status: 'ACTIVE',
        },
      });
    }

    const teacherProfile = await this.prisma.teacherProfile.create({
      data: {
        userId: user.id,
        schoolId,
        staffId: cleanStaffId,
        title: dto.title?.trim() || 'Lecturer',
        departmentId: dto.departmentId || null,
        specialization: dto.specialization?.trim(),
        assignedClasses: dto.assignedClassIds?.length
          ? { connect: dto.assignedClassIds.map((id) => ({ id })) }
          : undefined,
        assignedSubjects: dto.assignedSubjectIds?.length
          ? { connect: dto.assignedSubjectIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        user: true,
        department: true,
        assignedClasses: true,
        assignedSubjects: true,
      },
    });

    return {
      success: true,
      teacherProfile,
      credentialSlip: {
        fullName: dto.fullName.trim(),
        title: dto.title || 'Lecturer',
        staffId: cleanStaffId,
        loginId: cleanStaffId,
        email: staffEmail,
        initialPassword: commonPassword,
        schoolName: school.name,
        schoolCode: school.schoolCode,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async assignTeacherCourses(
    schoolId: string,
    teacherProfileId: string,
    dto: { classIds?: string[]; subjectIds?: string[] },
  ) {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { id: teacherProfileId, schoolId },
    });
    if (!profile) throw new NotFoundException('Teacher profile not found.');

    const updated = await this.prisma.teacherProfile.update({
      where: { id: teacherProfileId },
      data: {
        assignedClasses: dto.classIds ? { set: dto.classIds.map((id) => ({ id })) } : undefined,
        assignedSubjects: dto.subjectIds ? { set: dto.subjectIds.map((id) => ({ id })) } : undefined,
      },
      include: {
        user: true,
        assignedClasses: true,
        assignedSubjects: true,
      },
    });

    return { success: true, teacherProfile: updated };
  }

  // ============================================================================
  // STUDENT PROVISIONING & CSV BULK IMPORT
  // ============================================================================

  async getSchoolStudents(
    schoolId: string,
    query?: { departmentId?: string; classId?: string; search?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { schoolId };
    if (query?.departmentId) where.departmentId = query.departmentId;
    if (query?.classId) where.classId = query.classId;
    if (query?.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { matricOrAdmissionNo: { contains: s, mode: 'insensitive' } },
        { user: { fullName: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [total, students] = await Promise.all([
      this.prisma.studentProfile.count({ where }),
      this.prisma.studentProfile.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
              role: true,
              loginId: true,
              createdAt: true,
            },
          },
          department: true,
          schoolClass: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      students,
    };
  }

  async createSchoolStudent(
    schoolId: string,
    dto: {
      fullName: string;
      matricOrAdmissionNo: string;
      email?: string;
      departmentId?: string;
      classId?: string;
      level?: string;
    },
  ) {
    if (!dto.fullName?.trim() || !dto.matricOrAdmissionNo?.trim()) {
      throw new BadRequestException('Full name and Matric/Admission number are required.');
    }

    const cleanMatric = dto.matricOrAdmissionNo.trim().toUpperCase();
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');

    const existing = await this.prisma.studentProfile.findFirst({
      where: { schoolId, matricOrAdmissionNo: cleanMatric },
    });
    if (existing) {
      throw new BadRequestException(`Student with Matric/Admission "${cleanMatric}" already exists.`);
    }

    const safeSlug = (school.slug || 'school').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanId = cleanMatric.toLowerCase().replace(/[^a-z0-9]/g, '');
    const studentEmail = dto.email?.trim()?.toLowerCase() || `${cleanId}@${safeSlug}.spark`;

    const commonPassword = 'SparkPass2026!';
    const passwordHash = await bcrypt.hash(commonPassword, 10);

    let user = await this.prisma.user.findUnique({ where: { email: studentEmail } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: studentEmail,
          fullName: dto.fullName.trim(),
          passwordHash,
          role: 'STUDENT',
          schoolId,
          classId: dto.classId || null,
          loginId: cleanMatric,
          mustChangePassword: true,
          referralCode: `STU-${Math.floor(100000 + Math.random() * 900000)}`,
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: dto.fullName.trim(),
          role: 'STUDENT',
          schoolId,
          classId: dto.classId || null,
          loginId: cleanMatric,
          mustChangePassword: true,
        },
      });
    }

    let membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, schoolId },
    });
    if (!membership) {
      membership = await this.prisma.membership.create({
        data: {
          userId: user.id,
          schoolId,
          role: 'STUDENT',
          loginId: cleanMatric,
          mustChangePassword: true,
          status: 'ACTIVE',
        },
      });
    }

    const studentProfile = await this.prisma.studentProfile.create({
      data: {
        userId: user.id,
        schoolId,
        matricOrAdmissionNo: cleanMatric,
        departmentId: dto.departmentId || null,
        classId: dto.classId || null,
        level: dto.level?.trim() || '100L',
      },
      include: {
        user: true,
        department: true,
        schoolClass: true,
      },
    });

    return {
      success: true,
      studentProfile,
      credentialSlip: {
        fullName: dto.fullName.trim(),
        matricOrAdmissionNo: cleanMatric,
        loginId: cleanMatric,
        email: studentEmail,
        initialPassword: commonPassword,
        level: dto.level || '100L',
        schoolName: school.name,
        schoolCode: school.schoolCode,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async assignStudentClass(
    schoolId: string,
    studentProfileId: string,
    dto: {
      classId?: string | null;
      departmentId?: string | null;
      level?: string;
    },
  ) {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentProfileId, schoolId },
    });
    if (!profile) {
      throw new NotFoundException('Student profile not found in this institution.');
    }

    let resolvedClassId = dto.classId !== undefined ? dto.classId : profile.classId;
    let resolvedDeptId = dto.departmentId !== undefined ? dto.departmentId : profile.departmentId;
    let resolvedLevel = dto.level?.trim() || profile.level;

    if (resolvedClassId) {
      const cls = await this.prisma.schoolClass.findFirst({
        where: { id: resolvedClassId, schoolId },
      });
      if (!cls) {
        throw new BadRequestException('Selected class does not belong to this institution.');
      }
      if (!dto.level && cls.name) {
        resolvedLevel = cls.name;
      }
      if (!resolvedDeptId && cls.departmentId) {
        resolvedDeptId = cls.departmentId;
      }
    }

    const [updatedProfile] = await Promise.all([
      this.prisma.studentProfile.update({
        where: { id: studentProfileId },
        data: {
          classId: resolvedClassId || null,
          departmentId: resolvedDeptId || null,
          level: resolvedLevel,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
              role: true,
              loginId: true,
              createdAt: true,
            },
          },
          department: true,
          schoolClass: true,
        },
      }),
      this.prisma.user.update({
        where: { id: profile.userId },
        data: {
          classId: resolvedClassId || null,
        },
      }),
    ]);

    return {
      success: true,
      studentProfile: updatedProfile,
    };
  }

  private extractRowsFromXlsxBuffer(buffer: Buffer): string[][] {
    const zip = new AdmZip(buffer);
    const sharedStrings: string[] = [];

    const sharedEntry = zip.getEntry('xl/sharedStrings.xml');
    if (sharedEntry) {
      const xml = sharedEntry.getData().toString('utf8');
      const siMatches = xml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
      for (const si of siMatches) {
        const tMatches = si.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g) || [];
        const text = tMatches
          .map((t) =>
            t
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'"),
          )
          .join('');
        sharedStrings.push(text.trim());
      }
    }

    const sheetEntries = zip
      .getEntries()
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    if (sheetEntries.length === 0) {
      throw new BadRequestException('No worksheet found inside Excel file.');
    }

    const sheetXml = sheetEntries[0].getData().toString('utf8');
    const rowMatches = sheetXml.match(/<row[\s>][\s\S]*?<\/row>/g) || [];
    const rows: string[][] = [];

    const colLettersToIndex = (letters: string): number => {
      let idx = 0;
      for (let i = 0; i < letters.length; i++) {
        idx = idx * 26 + (letters.charCodeAt(i) - 64);
      }
      return Math.max(0, idx - 1);
    };

    for (const rowXml of rowMatches) {
      const cellMatches = rowXml.match(/<c[\s>][\s\S]*?(?:<\/c>|\/>)/g) || [];
      const rowCells: string[] = [];
      let nextIdx = 0;

      for (const cellXml of cellMatches) {
        const refMatch = cellXml.match(/\br="([A-Z]+)\d+"/i);
        const colIdx = refMatch ? colLettersToIndex(refMatch[1].toUpperCase()) : nextIdx;
        nextIdx = colIdx + 1;

        const typeMatch = cellXml.match(/\bt="([^"]+)"/);
        const cellType = typeMatch ? typeMatch[1] : '';

        let val = '';
        if (cellType === 'inlineStr') {
          const tMatch = cellXml.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/);
          val = tMatch ? tMatch[1] : '';
        } else {
          const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
          const rawV = vMatch ? vMatch[1].trim() : '';
          if (cellType === 's') {
            const sIdx = parseInt(rawV, 10);
            val = !isNaN(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : rawV;
          } else {
            val = rawV;
          }
        }

        val = val
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();

        while (rowCells.length < colIdx) {
          rowCells.push('');
        }
        rowCells[colIdx] = val;
      }

      if (rowCells.some((c) => c.trim().length > 0)) {
        rows.push(rowCells);
      }
    }

    return rows;
  }

  private parseDelimitedLine(line: string): string[] {
    if (line.includes('\t')) {
      return line.split('\t').map((s) => s.trim());
    }
    if (line.includes('|')) {
      return line
        .split('|')
        .map((s) => s.trim())
        .filter((s, idx, arr) => !( (idx === 0 || idx === arr.length - 1) && !s ));
    }
    if (line.includes(',')) {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    }
    if (line.includes(';')) {
      return line.split(';').map((s) => s.trim());
    }
    // Multiple spaces (e.g. extracted from PDF tables)
    return line.split(/\s{2,}/).map((s) => s.trim());
  }

  async parseStudentImportFile(
    schoolId: string,
    file?: { buffer?: Buffer; originalname?: string; mimetype?: string },
    body?: {
      fileBase64?: string;
      fileName?: string;
      mimeType?: string;
      rawText?: string;
    },
  ) {
    const [school, departments, classes, existingStudents] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: schoolId } }),
      this.prisma.department.findMany({ where: { schoolId } }),
      this.prisma.schoolClass.findMany({ where: { schoolId } }),
      this.prisma.studentProfile.findMany({
        where: { schoolId },
        select: { matricOrAdmissionNo: true },
      }),
    ]);

    if (!school) throw new NotFoundException('School not found.');

    let buffer: Buffer | null = file?.buffer || null;
    const resolvedFileName = file?.originalname || body?.fileName || 'student-list.csv';
    const resolvedMime = (file?.mimetype || body?.mimeType || '').toLowerCase();
    const lowerName = resolvedFileName.toLowerCase();

    if (!buffer && body?.fileBase64) {
      const cleanBase64 = body.fileBase64.includes('base64,')
        ? body.fileBase64.split('base64,')[1]
        : body.fileBase64;
      buffer = Buffer.from(cleanBase64, 'base64');
    }

    let rawRows: string[][] = [];
    let detectedFormat = 'CSV';

    if (
      buffer &&
      (lowerName.endsWith('.xlsx') ||
        resolvedMime.includes('spreadsheet') ||
        resolvedMime.includes('excel') ||
        (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b))
    ) {
      detectedFormat = 'EXCEL';
      rawRows = this.extractRowsFromXlsxBuffer(buffer);
    } else if (
      buffer &&
      (lowerName.endsWith('.pdf') ||
        resolvedMime.includes('pdf') ||
        buffer.subarray(0, 5).toString('ascii') === '%PDF-')
    ) {
      detectedFormat = 'PDF';
      let extractedText = '';
      try {
        const pdfExtractModule: any = await import('pdf-extraction');
        const pdfExtract = pdfExtractModule.default || pdfExtractModule;
        const pdfData = await pdfExtract(buffer);
        extractedText = pdfData?.text || '';
      } catch (err: any) {
        throw new BadRequestException(
          `Could not extract text from PDF file: ${err?.message || 'Invalid PDF'}`,
        );
      }

      const lines = extractedText
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*\d+[\.\)]\s+/, '').trim())
        .filter((l) => l.length > 2);

      for (const line of lines) {
        const cells = this.parseDelimitedLine(line);
        if (cells.length >= 2) {
          rawRows.push(cells);
        } else {
          // Single-line PDF row where tokens are separated by single spaces:
          // Try extracting Matric/Admission No, Class/Level, Dept, and Name
          const tokens = line.split(/\s+/);
          if (tokens.length >= 2) {
            rawRows.push(tokens);
          }
        }
      }
    } else {
      detectedFormat = lowerName.endsWith('.tsv') ? 'TSV' : 'CSV';
      const textContent = buffer ? buffer.toString('utf8') : body?.rawText || '';
      if (!textContent.trim()) {
        throw new BadRequestException('Please upload a CSV, Excel (.xlsx), or PDF file, or paste student rows.');
      }
      const lines = textContent
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*\d+[\.\)]\s+/, '').trim())
        .filter((l) => l.length > 0);
      rawRows = lines.map((l) => this.parseDelimitedLine(l));
    }

    if (rawRows.length === 0) {
      throw new BadRequestException('No student rows could be found in the uploaded file.');
    }

    const normalizeKey = (val: string) => (val || '').replace(/[\s\-_]+/g, '').toUpperCase();

    const classByNorm = new Map<string, { id: string; name: string; departmentId?: string | null }>();
    classes.forEach((c) => {
      classByNorm.set(normalizeKey(c.name), c);
      if (c.levelCode) classByNorm.set(normalizeKey(c.levelCode), c);
    });

    const deptByNorm = new Map<string, { id: string; name: string; code: string }>();
    departments.forEach((d) => {
      deptByNorm.set(normalizeKey(d.code), d);
      deptByNorm.set(normalizeKey(d.name), d);
      deptByNorm.set(normalizeKey(d.name.replace(/department|stream|track/gi, '')), d);
    });

    const existingMatricSet = new Set(
      existingStudents.map((s) => (s.matricOrAdmissionNo || '').trim().toUpperCase()),
    );

    const isSecondary =
      school.institutionType === 'SECONDARY' ||
      (school.terminologyConfig as any)?.educatorLabel === 'Teacher';

    // Check if first row is a header
    const firstRowLower = rawRows[0].map((c) => (c || '').toLowerCase().trim());
    const hasHeader = firstRowLower.some((h) =>
      /^(s\/n|sn|no|full\s*name|student\s*name|name|surname|first\s*name|matric|admission|reg\s*no|student\s*id|class|arm|level|dept|department|stream|email)$/i.test(
        h.replace(/[^a-z/\s]/g, '').trim(),
      ),
    );

    let nameIdx = -1;
    let firstNameIdx = -1;
    let lastNameIdx = -1;
    let matricIdx = -1;
    let deptIdx = -1;
    let classIdx = -1;
    let levelIdx = -1;
    let emailIdx = -1;

    if (hasHeader) {
      firstRowLower.forEach((h, i) => {
        if ((h.includes('full') && h.includes('name')) || h === 'name' || h === 'student name' || h === 'student') {
          nameIdx = i;
        } else if (h.includes('surname') || h.includes('last name') || h === 'lastname') {
          lastNameIdx = i;
        } else if (h.includes('first name') || h === 'firstname' || h.includes('other name')) {
          firstNameIdx = i;
        } else if (h.includes('matric') || h.includes('admission') || h.includes('reg') || h.includes('student id') || h === 'id') {
          matricIdx = i;
        } else if (h.includes('dept') || h.includes('department') || h.includes('stream')) {
          deptIdx = i;
        } else if (h.includes('class') || h.includes('arm') || h.includes('grade')) {
          classIdx = i;
        } else if (h.includes('level')) {
          levelIdx = i;
        } else if (h.includes('email') || h.includes('mail')) {
          emailIdx = i;
        }
      });
    }

    const startRow = hasHeader ? 1 : 0;
    const parsedStudents: Array<{
      rowNumber: number;
      fullName: string;
      matricOrAdmissionNo: string;
      autoGeneratedId: boolean;
      email?: string;
      className: string;
      matchedClassId: string | null;
      matchedClassName: string | null;
      classStatus: 'MATCHED' | 'NEW_CLASS' | 'UNASSIGNED';
      departmentCode: string;
      matchedDepartmentId: string | null;
      matchedDepartmentName: string | null;
      level: string;
      status: 'READY' | 'DUPLICATE';
    }> = [];

    const classPattern =
      /^(?:creche|pre[\s\-]*nursery|nursery\s*\d*[a-z]?|kg\s*\d*[a-z]?|primary\s*\d+[a-z]?|basic\s*\d+[a-z]?|jss\s*\d+[a-z]?|ss\s*\d+[a-z]?|sss\s*\d+[a-z]?|\d{3}\s*l(?:evel)?|nd\s*\d+[a-z]?|hnd\s*\d+[a-z]?)(?:\s+(?:gold|silver|diamond|[a-f]))?$/i;
    const idPattern = /^(?:[A-Z]{2,}[\/\-][A-Z0-9\/\-]+\d+|\d{4,}[A-Z0-9\/\-]*|[A-Z0-9]+[\/\-]\d{2,}[\/\-]\d+)$/i;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let r = startRow; r < rawRows.length; r++) {
      const cells = rawRows[r].map((c) => (c || '').trim()).filter((c, idx, arr) => arr.length > 0);
      if (cells.length === 0 || cells.every((c) => !c)) continue;

      // Skip obvious title/footer lines in PDFs
      const joinedLine = cells.join(' ');
      if (
        /^(page\s+\d+|total\s+students|class\s+list|student\s+roster|ministry\s+of)/i.test(joinedLine) &&
        cells.length <= 2
      ) {
        continue;
      }

      let fullName = '';
      let matricNo = '';
      let deptRaw = '';
      let classRaw = '';
      let levelRaw = '';
      let emailRaw = '';

      if (hasHeader && (nameIdx >= 0 || (firstNameIdx >= 0 && lastNameIdx >= 0))) {
        if (nameIdx >= 0) {
          fullName = cells[nameIdx] || '';
        } else {
          fullName = `${cells[lastNameIdx] || ''} ${cells[firstNameIdx] || ''}`.trim();
        }
        if (matricIdx >= 0) matricNo = cells[matricIdx] || '';
        if (deptIdx >= 0) deptRaw = cells[deptIdx] || '';
        if (classIdx >= 0) classRaw = cells[classIdx] || '';
        if (levelIdx >= 0) levelRaw = cells[levelIdx] || '';
        if (emailIdx >= 0) emailRaw = cells[emailIdx] || '';
      } else {
        // Smart heuristic cell classifier for headerless CSV / Excel / PDF rows
        const remaining: string[] = [];
        for (const cell of cells) {
          if (!cell || /^\d{1,3}$/.test(cell)) {
            // Serial number column like "1", "2", "3"
            continue;
          }
          if (!emailRaw && emailPattern.test(cell)) {
            emailRaw = cell;
          } else if (!classRaw && (classByNorm.has(normalizeKey(cell)) || classPattern.test(cell))) {
            classRaw = cell;
          } else if (!deptRaw && deptByNorm.has(normalizeKey(cell))) {
            deptRaw = cell;
          } else if (!matricNo && idPattern.test(cell)) {
            matricNo = cell;
          } else {
            remaining.push(cell);
          }
        }

        if (remaining.length > 0) {
          // If PDF row had tokens split by space and no commas, combine alphabetical name tokens
          if (detectedFormat === 'PDF' && remaining.every((tok) => /^[a-zA-Z\-\.']+$/.test(tok))) {
            fullName = remaining.join(' ');
          } else {
            fullName = remaining[0] || '';
            if (!matricNo && remaining[1] && /\d/.test(remaining[1])) {
              matricNo = remaining[1];
            } else if (!deptRaw && remaining[1]) {
              deptRaw = remaining[1];
            }
            if (!classRaw && remaining[2]) {
              classRaw = remaining[2];
            }
          }
        }
      }

      fullName = fullName.replace(/^[\d\.\)\-\s]+/, '').trim();
      if (!fullName || fullName.length < 2) continue;

      let autoGeneratedId = false;
      if (!matricNo) {
        autoGeneratedId = true;
        const prefix = (school.schoolCode || 'STU').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();
        matricNo = `${prefix}/2026/${String(existingStudents.length + parsedStudents.length + 1).padStart(3, '0')}`;
      } else {
        matricNo = matricNo.toUpperCase();
      }

      const effectiveClassText = (classRaw || levelRaw || '').trim();
      const matchedClass = effectiveClassText
        ? classByNorm.get(normalizeKey(effectiveClassText)) || null
        : null;

      const matchedDept = deptRaw
        ? deptByNorm.get(normalizeKey(deptRaw)) ||
          deptByNorm.get(normalizeKey(deptRaw.replace(/department|dept|stream/gi, ''))) ||
          null
        : matchedClass?.departmentId
          ? departments.find((d) => d.id === matchedClass.departmentId) || null
          : null;

      const resolvedLevel =
        matchedClass?.name ||
        effectiveClassText ||
        (isSecondary ? 'JSS 1A' : '100L');

      const isDup = existingMatricSet.has(matricNo);

      parsedStudents.push({
        rowNumber: r + 1,
        fullName,
        matricOrAdmissionNo: matricNo,
        autoGeneratedId,
        email: emailRaw || undefined,
        className: matchedClass?.name || effectiveClassText || '',
        matchedClassId: matchedClass?.id || null,
        matchedClassName: matchedClass?.name || null,
        classStatus: matchedClass
          ? 'MATCHED'
          : effectiveClassText
            ? 'NEW_CLASS'
            : 'UNASSIGNED',
        departmentCode: matchedDept?.code || deptRaw || '',
        matchedDepartmentId: matchedDept?.id || null,
        matchedDepartmentName: matchedDept?.name || null,
        level: resolvedLevel,
        status: isDup ? 'DUPLICATE' : 'READY',
      });
    }

    if (parsedStudents.length === 0) {
      throw new BadRequestException(
        'No valid student records could be extracted. Ensure the file contains student names and admission/matric numbers or classes.',
      );
    }

    return {
      success: true,
      fileName: resolvedFileName,
      fileType: detectedFormat,
      totalRows: parsedStudents.length,
      readyCount: parsedStudents.filter((s) => s.status === 'READY').length,
      duplicateCount: parsedStudents.filter((s) => s.status === 'DUPLICATE').length,
      parsedStudents,
    };
  }

  async bulkImportStudents(
    schoolId: string,
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
    if (!dto.students?.length) {
      throw new BadRequestException('Student rows are required for bulk import.');
    }

    const [departments, classes, school] = await Promise.all([
      this.prisma.department.findMany({ where: { schoolId } }),
      this.prisma.schoolClass.findMany({ where: { schoolId } }),
      this.prisma.school.findUnique({ where: { id: schoolId } }),
    ]);

    if (!school) throw new NotFoundException('School not found.');

    const normalizeKey = (val: string) => (val || '').replace(/[\s\-_]+/g, '').toUpperCase();

    const deptMap = new Map<string, string>();
    departments.forEach((d) => {
      deptMap.set(d.id, d.id);
      deptMap.set(normalizeKey(d.code), d.id);
      deptMap.set(normalizeKey(d.name), d.id);
    });

    const classMap = new Map<string, string>();
    classes.forEach((c) => {
      classMap.set(c.id, c.id);
      classMap.set(normalizeKey(c.name), c.id);
      if (c.levelCode) classMap.set(normalizeKey(c.levelCode), c.id);
    });

    const slips: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < dto.students.length; i++) {
      const row = dto.students[i];
      if (!row.fullName?.trim() || !row.matricOrAdmissionNo?.trim()) {
        errors.push({ row: i + 1, error: 'Full name and Matric/Admission number are required.' });
        continue;
      }

      const deptId =
        row.departmentId ||
        (row.departmentCode
          ? deptMap.get(normalizeKey(row.departmentCode))
          : undefined);

      let clsId =
        row.classId ||
        (row.className ? classMap.get(normalizeKey(row.className)) : undefined);

      // If the imported file specified a class name (e.g. "JSS 1B" or "SS 2A") that doesn't exist yet, create it!
      if (!clsId && row.className?.trim()) {
        const cleanClassName = row.className.trim();
        const normClass = normalizeKey(cleanClassName);
        if (classMap.has(normClass)) {
          clsId = classMap.get(normClass);
        } else {
          try {
            const createdCls = await this.createSchoolClass(schoolId, {
              name: cleanClassName,
              levelCode: normClass.slice(0, 8),
              departmentId: deptId,
            });
            clsId = createdCls.schoolClass.id;
            classMap.set(normClass, clsId);
          } catch {
            // Ignore class auto-create error and continue
          }
        }
      }

      try {
        const res = await this.createSchoolStudent(schoolId, {
          fullName: row.fullName,
          matricOrAdmissionNo: row.matricOrAdmissionNo,
          email: row.email,
          departmentId: deptId,
          classId: clsId,
          level: row.level || row.className || '100L',
        });
        slips.push(res.credentialSlip);
      } catch (err: any) {
        errors.push({
          row: i + 1,
          matricOrAdmissionNo: row.matricOrAdmissionNo,
          error: err?.message || 'Failed to create student',
        });
      }
    }

    return {
      success: true,
      totalSubmitted: dto.students.length,
      createdCount: slips.length,
      failedCount: errors.length,
      credentialSlips: slips,
      errors,
    };
  }

  // ============================================================================
  // SCHOOL PROFILE SETTINGS
  // ============================================================================

  async updateSchoolSettings(
    schoolId: string,
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
    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        name: dto.name?.trim() || undefined,
        logoUrl: dto.logoUrl?.trim() || undefined,
        primaryColor: dto.primaryColor?.trim() || undefined,
        secondaryColor: dto.secondaryColor?.trim() || undefined,
        address: dto.address?.trim() || undefined,
        contactEmail: dto.contactEmail?.trim() || undefined,
        contactPhone: dto.contactPhone?.trim() || undefined,
        terminologyConfig: dto.terminologyConfig || undefined,
      },
    });

    return { success: true, school: updated };
  }
}
