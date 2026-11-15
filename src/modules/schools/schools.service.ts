import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import AdmZip from 'adm-zip';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
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

  async updateAcademicUnit(
    schoolId: string,
    unitId: string,
    dto: { name?: string; code?: string; unitType?: string; description?: string },
  ) {
    const existing = await this.prisma.academicUnit.findFirst({
      where: { id: unitId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Section / Faculty not found.');
    }

    const cleanName = dto.name?.trim() || existing.name;
    const cleanCode = dto.code?.trim().toUpperCase() || existing.code;
    const conflict = await this.prisma.academicUnit.findFirst({
      where: {
        schoolId,
        id: { not: unitId },
        OR: [
          { code: cleanCode },
          { name: { equals: cleanName, mode: 'insensitive' } },
        ],
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `Another Section / Faculty already uses "${cleanName}" or code "${cleanCode}".`,
      );
    }

    const updated = await this.prisma.academicUnit.update({
      where: { id: unitId },
      data: {
        name: cleanName,
        code: cleanCode,
        unitType: dto.unitType?.trim() || existing.unitType,
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
      },
    });
    return { success: true, academicUnit: updated };
  }

  async deleteAcademicUnit(schoolId: string, unitId: string) {
    const existing = await this.prisma.academicUnit.findFirst({
      where: { id: unitId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Section / Faculty not found.');
    }
    await this.prisma.department.updateMany({
      where: { schoolId, unitId },
      data: { unitId: null },
    });
    await this.prisma.academicUnit.delete({ where: { id: unitId } });
    return { success: true, deletedId: unitId };
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

  async updateDepartment(
    schoolId: string,
    deptId: string,
    dto: { name?: string; code?: string; unitId?: string | null },
  ) {
    const existing = await this.prisma.department.findFirst({
      where: { id: deptId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Department not found.');
    }

    const cleanName = dto.name?.trim() || existing.name;
    const cleanCode = dto.code?.trim().toUpperCase() || existing.code;
    const conflict = await this.prisma.department.findFirst({
      where: {
        schoolId,
        id: { not: deptId },
        OR: [
          { code: cleanCode },
          { name: { equals: cleanName, mode: 'insensitive' } },
        ],
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `Another department already uses "${cleanName}" or code "${cleanCode}".`,
      );
    }

    const updated = await this.prisma.department.update({
      where: { id: deptId },
      data: {
        name: cleanName,
        code: cleanCode,
        unitId: dto.unitId !== undefined ? dto.unitId || null : undefined,
      },
      include: { unit: true },
    });
    return { success: true, department: updated };
  }

  async deleteDepartment(schoolId: string, deptId: string) {
    const existing = await this.prisma.department.findFirst({
      where: { id: deptId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Department not found.');
    }
    await Promise.all([
      this.prisma.schoolClass.updateMany({
        where: { schoolId, departmentId: deptId },
        data: { departmentId: null },
      }),
      this.prisma.schoolSubject.updateMany({
        where: { schoolId, departmentId: deptId },
        data: { departmentId: null },
      }),
    ]);
    await this.prisma.department.delete({ where: { id: deptId } });
    return { success: true, deletedId: deptId };
  }

  private normalizeCreditUnits(raw?: number | string | null): number | null {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 30) {
      return null;
    }
    return Math.floor(parsed);
  }

  private buildAutoCourseCode(name: string, classNameOrCode?: string): string {
    const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    const subjPart =
      words.length >= 2
        ? words
            .slice(0, 3)
            .map((w) => w[0])
            .join('')
            .toUpperCase()
        : clean.slice(0, 3).toUpperCase() || 'SUB';
    const classPart = (classNameOrCode || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    return classPart ? `${subjPart}-${classPart}` : `${subjPart}101`;
  }

  async createSchoolClass(
    schoolId: string,
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
    const levelCode = dto.levelCode?.trim();
    const schoolClass = await this.prisma.schoolClass.create({
      data: {
        schoolId,
        name: cleanName,
        levelCode,
        departmentId: dto.departmentId || null,
        termOrSemester: dto.termOrSemester?.trim(),
        inviteCode,
      },
      include: { department: true },
    });

    let createdSubjects: any[] = [];
    if (Array.isArray(dto.subjects) && dto.subjects.length > 0) {
      const batchResult = await this.assignSubjectsToClass(schoolId, schoolClass.id, {
        subjects: dto.subjects,
      });
      createdSubjects = batchResult.subjects;
    }

    return {
      success: true,
      schoolClass: {
        ...schoolClass,
        subjects: createdSubjects,
      },
    };
  }

  async assignSubjectsToClass(
    schoolId: string,
    classId: string,
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
    const schoolClass = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
      include: { subjects: true },
    });
    if (!schoolClass) {
      throw new NotFoundException('Target class not found for this institution.');
    }

    const items = Array.isArray(dto.subjects) ? dto.subjects : [];
    const seenNames = new Set(
      schoolClass.subjects.map((s) => s.name.trim().toLowerCase()),
    );
    const seenCodes = new Set(
      schoolClass.subjects.map((s) => s.courseCode.trim().toUpperCase()),
    );

    const created: any[] = [];
    for (const item of items) {
      const cleanName = item?.name?.trim();
      if (!cleanName) continue;
      if (seenNames.has(cleanName.toLowerCase())) continue;

      let cleanCode = (
        item.courseCode?.trim() ||
        this.buildAutoCourseCode(
          cleanName,
          schoolClass.levelCode || schoolClass.name,
        )
      ).toUpperCase();

      // Ensure course code uniqueness inside the class
      let suffix = 2;
      const baseCode = cleanCode;
      while (seenCodes.has(cleanCode)) {
        cleanCode = `${baseCode}${suffix}`;
        suffix += 1;
      }

      const subject = await this.prisma.schoolSubject.create({
        data: {
          schoolId,
          classId: schoolClass.id,
          departmentId: item.departmentId || schoolClass.departmentId || null,
          name: cleanName,
          courseCode: cleanCode,
          creditUnits: this.normalizeCreditUnits(item.creditUnits),
          minAttendancePercent: item.minAttendancePercent ?? 75.0,
        },
        include: {
          schoolClass: true,
          department: true,
        },
      });
      seenNames.add(cleanName.toLowerCase());
      seenCodes.add(cleanCode);
      created.push(subject);
    }

    return { success: true, subjects: created, count: created.length };
  }

  async createSchoolSubject(
    schoolId: string,
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
    const targetClassIds = Array.from(
      new Set([
        ...(Array.isArray(dto.classIds) ? dto.classIds : []),
        ...(dto.classId ? [dto.classId] : []),
      ].filter(Boolean)),
    );

    if (!dto.name?.trim() || targetClassIds.length === 0) {
      throw new BadRequestException(
        'Subject / course name and at least one target class are required.',
      );
    }

    const cleanName = dto.name.trim();
    const classes = await this.prisma.schoolClass.findMany({
      where: { schoolId, id: { in: targetClassIds } },
    });
    if (classes.length === 0) {
      throw new NotFoundException('Target class not found for this institution.');
    }

    const createdSubjects: any[] = [];
    for (const cls of classes) {
      const baseCode = (
        dto.courseCode?.trim() ||
        this.buildAutoCourseCode(cleanName, cls.levelCode || cls.name)
      ).toUpperCase();

      const existingSubject = await this.prisma.schoolSubject.findFirst({
        where: {
          schoolId,
          classId: cls.id,
          OR: [
            { name: { equals: cleanName, mode: 'insensitive' } },
            { courseCode: { equals: baseCode, mode: 'insensitive' } },
          ],
        },
      });

      if (existingSubject) {
        if (classes.length === 1) {
          throw new BadRequestException(
            `Subject / Course "${cleanName}" (${baseCode}) is already registered for ${cls.name}.`,
          );
        }
        continue;
      }

      const subject = await this.prisma.schoolSubject.create({
        data: {
          schoolId,
          classId: cls.id,
          departmentId: dto.departmentId || cls.departmentId || null,
          name: cleanName,
          courseCode: baseCode,
          creditUnits: this.normalizeCreditUnits(dto.creditUnits),
          minAttendancePercent: dto.minAttendancePercent ?? 75.0,
        },
        include: {
          schoolClass: true,
          department: true,
        },
      });
      createdSubjects.push(subject);
    }

    if (createdSubjects.length === 0) {
      throw new BadRequestException(
        `"${cleanName}" is already registered in the selected class(es).`,
      );
    }

    return {
      success: true,
      subject: createdSubjects[0],
      subjects: createdSubjects,
    };
  }

  async updateSchoolClass(
    schoolId: string,
    classId: string,
    dto: {
      name?: string;
      levelCode?: string;
      departmentId?: string | null;
      termOrSemester?: string;
    },
  ) {
    const existing = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Class / Level not found.');
    }

    const cleanName = dto.name?.trim() || existing.name;
    const nextDeptId =
      dto.departmentId !== undefined ? dto.departmentId || null : existing.departmentId;

    const normalizeClassKey = (val: string) =>
      val.replace(/[\s\-_]+/g, '').toUpperCase();
    const targetKey = normalizeClassKey(cleanName);

    const peers = await this.prisma.schoolClass.findMany({
      where: { schoolId, id: { not: classId } },
      select: { id: true, name: true, departmentId: true },
    });
    const duplicate = peers.find((c) => {
      if (normalizeClassKey(c.name) !== targetKey) return false;
      if (nextDeptId && c.departmentId && nextDeptId !== c.departmentId) {
        return false;
      }
      return true;
    });
    if (duplicate) {
      throw new BadRequestException(
        `Class "${cleanName}" already exists in this institution.`,
      );
    }

    const updated = await this.prisma.schoolClass.update({
      where: { id: classId },
      data: {
        name: cleanName,
        levelCode:
          dto.levelCode !== undefined
            ? dto.levelCode?.trim().toUpperCase() || null
            : undefined,
        departmentId: nextDeptId,
        termOrSemester:
          dto.termOrSemester !== undefined
            ? dto.termOrSemester?.trim() || null
            : undefined,
      },
      include: { department: true, subjects: true },
    });
    return { success: true, schoolClass: updated };
  }

  async deleteSchoolClass(schoolId: string, classId: string) {
    const existing = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Class / Level not found.');
    }
    await Promise.all([
      this.prisma.studentProfile.updateMany({
        where: { schoolId, classId },
        data: { classId: null },
      }),
      this.prisma.user.updateMany({
        where: { schoolId, classId },
        data: { classId: null },
      }),
    ]);
    await this.prisma.schoolClass.delete({ where: { id: classId } });
    return { success: true, deletedId: classId };
  }

  async updateSchoolSubject(
    schoolId: string,
    subjectId: string,
    dto: {
      name?: string;
      courseCode?: string;
      creditUnits?: number | null;
      classId?: string;
      departmentId?: string | null;
      minAttendancePercent?: number;
    },
  ) {
    const existing = await this.prisma.schoolSubject.findFirst({
      where: { id: subjectId, schoolId },
      include: { schoolClass: true },
    });
    if (!existing) {
      throw new NotFoundException('Subject / Course not found.');
    }

    const targetClassId = dto.classId || existing.classId;
    const cleanName = dto.name?.trim() || existing.name;
    const cleanCode = dto.courseCode?.trim().toUpperCase() || existing.courseCode;

    const conflict = await this.prisma.schoolSubject.findFirst({
      where: {
        schoolId,
        classId: targetClassId,
        id: { not: subjectId },
        OR: [
          { name: { equals: cleanName, mode: 'insensitive' } },
          { courseCode: { equals: cleanCode, mode: 'insensitive' } },
        ],
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `Subject "${cleanName}" (${cleanCode}) is already registered in this class.`,
      );
    }

    const updated = await this.prisma.schoolSubject.update({
      where: { id: subjectId },
      data: {
        name: cleanName,
        courseCode: cleanCode,
        classId: targetClassId,
        departmentId:
          dto.departmentId !== undefined ? dto.departmentId || null : undefined,
        creditUnits:
          dto.creditUnits !== undefined
            ? this.normalizeCreditUnits(dto.creditUnits)
            : undefined,
        minAttendancePercent:
          dto.minAttendancePercent !== undefined
            ? Number(dto.minAttendancePercent) || 75.0
            : undefined,
      },
      include: { schoolClass: true, department: true },
    });
    return { success: true, subject: updated };
  }

  async deleteSchoolSubject(schoolId: string, subjectId: string) {
    const existing = await this.prisma.schoolSubject.findFirst({
      where: { id: subjectId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Subject / Course not found.');
    }
    await this.prisma.schoolSubject.delete({ where: { id: subjectId } });
    return { success: true, deletedId: subjectId };
  }

  async getSchoolClassDetails(schoolId: string, classId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, institutionType: true },
    });
    if (!school) throw new NotFoundException('Institution not found.');

    const schoolClass = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
      include: {
        department: {
          include: { unit: true },
        },
        subjects: {
          include: {
            teacher: { select: { id: true, fullName: true, email: true } },
            assignedTeachers: {
              include: {
                user: { select: { id: true, fullName: true, email: true } },
              },
            },
          },
          orderBy: { name: 'asc' },
        },
        teacherProfiles: {
          include: {
            user: { select: { id: true, fullName: true, email: true } },
            assignedSubjects: {
              where: { classId },
              select: { id: true, name: true, courseCode: true },
            },
          },
        },
      },
    });
    if (!schoolClass) {
      throw new NotFoundException('Class / Level not found in this institution.');
    }

    const instUpper = String(school.institutionType || '').toUpperCase();
    const isTertiary =
      instUpper.includes('UNIV') ||
      instUpper.includes('POLY') ||
      instUpper.includes('COLLEG') ||
      instUpper.includes('TERT');

    const [
      studentProfiles,
      currentTerm,
      attendanceSessions,
      historyRows,
      formTeacherUser,
    ] = await Promise.all([
      this.prisma.studentProfile.findMany({
        where: { schoolId, classId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
              loginId: true,
              createdAt: true,
            },
          },
          department: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.academicTerm.findFirst({
        where: { session: { schoolId } },
        orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
        include: { session: { select: { name: true } } },
      }),
      this.prisma.attendanceSession.findMany({
        where: { schoolId, classId },
        include: {
          subject: { select: { id: true, name: true, courseCode: true } },
          records: { select: { studentId: true, status: true } },
        },
        orderBy: { sessionDate: 'desc' },
        take: 100,
      }),
      this.prisma.classTeacherAssignmentHistory.findMany({
        where: { schoolId, classId },
        include: {
          teacherProfile: {
            include: {
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
        orderBy: [{ assignedAt: 'desc' }],
      }),
      schoolClass.formTeacherId
        ? this.prisma.teacherProfile.findFirst({
            where: { schoolId, userId: schoolClass.formTeacherId },
            include: {
              user: { select: { id: true, fullName: true, email: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    // Attendance metrics overall and per student
    const totalSessions = attendanceSessions.length;
    let presentCount = 0;
    let lateCount = 0;
    let excusedCount = 0;
    let absentCount = 0;
    const studentAttendedMap = new Map<string, number>();

    for (const sess of attendanceSessions) {
      for (const rec of sess.records) {
        if (rec.status === 'PRESENT') {
          presentCount += 1;
          studentAttendedMap.set(
            rec.studentId,
            (studentAttendedMap.get(rec.studentId) || 0) + 1,
          );
        } else if (rec.status === 'LATE') {
          lateCount += 1;
          studentAttendedMap.set(
            rec.studentId,
            (studentAttendedMap.get(rec.studentId) || 0) + 1,
          );
        } else if (rec.status === 'EXCUSED') {
          excusedCount += 1;
          studentAttendedMap.set(
            rec.studentId,
            (studentAttendedMap.get(rec.studentId) || 0) + 1,
          );
        } else {
          absentCount += 1;
        }
      }
    }

    const totalRollCalls = presentCount + lateCount + excusedCount + absentCount;
    const overallAttendancePercent =
      totalRollCalls > 0
        ? Math.round(((presentCount + lateCount + excusedCount) / totalRollCalls) * 100)
        : 100;

    // Leading students in current active term
    let leadingStudents: Array<{
      studentProfileId: string | null;
      userId: string;
      fullName: string;
      matricOrAdmissionNo: string;
      overallAverage: number;
      gpa: number | null;
      overallPosition: number | null;
      overallOrdinal: string | null;
      subjectsGraded: number;
    }> = [];

    const profileByUserId = new Map(studentProfiles.map((sp) => [sp.userId, sp]));

    if (currentTerm && studentProfiles.length > 0) {
      const reportCards = await this.prisma.terminalReportCard.findMany({
        where: { schoolId, classId, termId: currentTerm.id },
        orderBy: isTertiary
          ? [{ gpa: 'desc' }, { overallAverage: 'desc' }]
          : [{ overallPosition: 'asc' }, { overallAverage: 'desc' }],
        take: 5,
      });

      if (reportCards.length > 0) {
        leadingStudents = reportCards
          .filter((rc) => profileByUserId.has(rc.studentId))
          .map((rc, idx) => {
            const sp = profileByUserId.get(rc.studentId)!;
            return {
              studentProfileId: sp.id,
              userId: sp.userId,
              fullName: sp.user.fullName || 'Student',
              matricOrAdmissionNo: sp.matricOrAdmissionNo || sp.user.loginId || 'N/A',
              overallAverage: Math.round((Number(rc.overallAverage) || 0) * 10) / 10,
              gpa: rc.gpa != null ? Math.round(Number(rc.gpa) * 100) / 100 : null,
              overallPosition: rc.overallPosition ?? idx + 1,
              overallOrdinal: rc.overallOrdinal ?? null,
              subjectsGraded: 0,
            };
          });
      } else {
        const gradeRows = await this.prisma.studentSubjectGrade.findMany({
          where: { schoolId, classId, termId: currentTerm.id },
          select: { studentId: true, totalScore: true, gradePoint: true },
        });
        const agg = new Map<string, { sum: number; count: number; gpSum: number }>();
        for (const g of gradeRows) {
          const cur = agg.get(g.studentId) || { sum: 0, count: 0, gpSum: 0 };
          cur.sum += Number(g.totalScore) || 0;
          cur.gpSum += Number(g.gradePoint) || 0;
          cur.count += 1;
          agg.set(g.studentId, cur);
        }
        leadingStudents = Array.from(agg.entries())
          .filter(([uid]) => profileByUserId.has(uid))
          .map(([uid, stats]) => {
            const sp = profileByUserId.get(uid)!;
            return {
              studentProfileId: sp.id,
              userId: uid,
              fullName: sp.user.fullName || 'Student',
              matricOrAdmissionNo: sp.matricOrAdmissionNo || sp.user.loginId || 'N/A',
              overallAverage: Math.round((stats.sum / stats.count) * 10) / 10,
              gpa: Math.round((stats.gpSum / stats.count) * 100) / 100,
              overallPosition: null,
              overallOrdinal: null,
              subjectsGraded: stats.count,
            };
          })
          .sort((a, b) => b.overallAverage - a.overallAverage)
          .slice(0, 5)
          .map((item, idx) => ({ ...item, overallPosition: idx + 1 }));
      }
    }

    // Current teachers deduplicated
    const teacherMap = new Map<
      string,
      {
        teacherProfileId: string | null;
        userId: string;
        fullName: string;
        title: string;
        staffId: string;
        email: string;
        roles: Set<string>;
        subjects: Set<string>;
      }
    >();

    const upsertTeacher = (
      userId: string,
      info: {
        teacherProfileId?: string | null;
        fullName?: string | null;
        title?: string | null;
        staffId?: string | null;
        email?: string | null;
      },
      role?: string,
      subjectName?: string,
    ) => {
      let entry = teacherMap.get(userId);
      if (!entry) {
        entry = {
          teacherProfileId: info.teacherProfileId ?? null,
          userId,
          fullName: info.fullName || 'Instructor',
          title: info.title || 'Teacher',
          staffId: info.staffId || 'STAFF',
          email: info.email || '',
          roles: new Set<string>(),
          subjects: new Set<string>(),
        };
        teacherMap.set(userId, entry);
      }
      if (role) entry.roles.add(role);
      if (subjectName) entry.subjects.add(subjectName);
    };

    if (formTeacherUser) {
      upsertTeacher(
        formTeacherUser.userId,
        {
          teacherProfileId: formTeacherUser.id,
          fullName: formTeacherUser.user?.fullName,
          title: formTeacherUser.title,
          staffId: formTeacherUser.staffId,
          email: formTeacherUser.user?.email,
        },
        'Form Teacher',
      );
    }

    for (const tp of schoolClass.teacherProfiles) {
      upsertTeacher(
        tp.userId,
        {
          teacherProfileId: tp.id,
          fullName: tp.user?.fullName,
          title: tp.title,
          staffId: tp.staffId,
          email: tp.user?.email,
        },
        'Class Teacher',
      );
      for (const s of tp.assignedSubjects) {
        upsertTeacher(tp.userId, { teacherProfileId: tp.id }, 'Subject Teacher', s.name);
      }
    }

    for (const subj of schoolClass.subjects) {
      if (subj.teacher) {
        upsertTeacher(
          subj.teacher.id,
          {
            fullName: subj.teacher.fullName,
            email: subj.teacher.email,
          },
          'Subject Teacher',
          subj.name,
        );
      }
      for (const tp of subj.assignedTeachers) {
        upsertTeacher(
          tp.userId,
          {
            teacherProfileId: tp.id,
            fullName: tp.user?.fullName,
            title: tp.title,
            staffId: tp.staffId,
            email: tp.user?.email,
          },
          'Subject Teacher',
          subj.name,
        );
      }
    }

    const currentTeachers = Array.from(teacherMap.values()).map((t) => ({
      teacherProfileId: t.teacherProfileId,
      userId: t.userId,
      fullName: t.fullName,
      title: t.title,
      staffId: t.staffId,
      email: t.email,
      roles: Array.from(t.roles),
      subjects: Array.from(t.subjects),
    }));

    const currentTeacherProfileIds = new Set(
      currentTeachers.map((t) => t.teacherProfileId).filter(Boolean),
    );
    const pastTeachers = historyRows
      .filter(
        (h) =>
          h.unassignedAt !== null &&
          !currentTeacherProfileIds.has(h.teacherProfileId),
      )
      .map((h) => ({
        historyId: h.id,
        teacherProfileId: h.teacherProfileId,
        fullName: h.teacherProfile.user?.fullName || 'Former Teacher',
        title: h.teacherProfile.title || 'Teacher',
        staffId: h.teacherProfile.staffId || 'STAFF',
        email: h.teacherProfile.user?.email || '',
        roleLabel: h.roleLabel || 'Assigned Teacher',
        subjectSummary: h.subjectSummary || null,
        assignedAt: h.assignedAt.toISOString(),
        unassignedAt: h.unassignedAt ? h.unassignedAt.toISOString() : null,
      }));

    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const students = studentProfiles.map((sp) => {
      const attended = studentAttendedMap.get(sp.userId) || 0;
      const attPct =
        totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : null;
      return {
        id: sp.id,
        userId: sp.userId,
        fullName: sp.user.fullName || 'Student',
        email: sp.user.email,
        avatarUrl: sp.user.avatarUrl,
        matricOrAdmissionNo: sp.matricOrAdmissionNo || sp.user.loginId || 'N/A',
        age: sp.age ?? null,
        guardianName: sp.guardianName ?? null,
        guardianRelationship: sp.guardianRelationship ?? null,
        guardianEmail: sp.guardianEmail ?? null,
        guardianPhone: sp.guardianPhone ?? null,
        departmentName: sp.department?.name || 'General',
        levelCode: schoolClass.levelCode || sp.level || null,
        attendancePercent: attPct,
        createdAt: sp.createdAt.toISOString(),
        isNew: sp.createdAt.getTime() >= fourteenDaysAgo,
      };
    });

    const newStudents = students.filter((s) => s.isNew);

    return {
      success: true,
      isTertiary,
      schoolClass: {
        id: schoolClass.id,
        name: schoolClass.name,
        levelCode: schoolClass.levelCode,
        inviteCode: schoolClass.inviteCode,
        department: schoolClass.department
          ? {
              id: schoolClass.department.id,
              name: schoolClass.department.name,
              code: schoolClass.department.code,
              unitName: schoolClass.department.unit?.name || null,
            }
          : null,
      },
      currentTerm: currentTerm
        ? {
            id: currentTerm.id,
            name: currentTerm.name,
            sessionName: currentTerm.session?.name || '',
          }
        : null,
      counts: {
        totalStudents: students.length,
        newStudentsCount: newStudents.length,
        subjectsCount: schoolClass.subjects.length,
        currentTeachersCount: currentTeachers.length,
        pastTeachersCount: pastTeachers.length,
        attendancePercent: overallAttendancePercent,
        totalSessions,
      },
      subjects: schoolClass.subjects.map((s) => ({
        id: s.id,
        name: s.name,
        courseCode: s.courseCode,
        creditUnits: s.creditUnits,
        minAttendancePercent: s.minAttendancePercent,
        assignedTeachers: [
          ...(s.teacher
            ? [{ id: s.teacher.id, fullName: s.teacher.fullName || 'Teacher' }]
            : []),
          ...s.assignedTeachers.map((tp) => ({
            id: tp.id,
            fullName: tp.user?.fullName || 'Teacher',
          })),
        ],
      })),
      students,
      newStudents,
      leadingStudents,
      currentTeachers,
      pastTeachers,
      attendanceSummary: {
        overallPercent: overallAttendancePercent,
        totalSessions,
        presentCount,
        lateCount,
        excusedCount,
        absentCount,
        recentSessions: attendanceSessions.slice(0, 8).map((sess) => ({
          id: sess.id,
          date: sess.sessionDate.toISOString(),
          subjectName: sess.subject?.name || 'Class Daily Register',
          courseCode: sess.subject?.courseCode || schoolClass.name,
          presentCount: sess.records.filter(
            (r) => r.status === 'PRESENT' || r.status === 'LATE',
          ).length,
          totalMarked: sess.records.length,
        })),
      },
    };
  }

  // ============================================================================
  // STAFF & TEACHER PROVISIONING
  // ============================================================================

  async getSchoolStaff(schoolId: string) {
    const [staffRaw, formAssignedClasses] = await Promise.all([
      this.prisma.teacherProfile.findMany({
        where: { schoolId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
              avatarUrl: true,
              loginId: true,
              createdAt: true,
            },
          },
          department: {
            include: { unit: true },
          },
          assignedClasses: {
            include: {
              department: true,
              _count: {
                select: {
                  studentProfiles: true,
                  subjects: true,
                },
              },
            },
          },
          assignedSubjects: {
            include: {
              schoolClass: true,
              department: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId, formTeacherId: { not: null } },
        select: {
          id: true,
          name: true,
          levelCode: true,
          formTeacherId: true,
        },
      }),
    ]);

    const formMap = new Map<
      string,
      Array<{ id: string; name: string; levelCode: string | null }>
    >();
    for (const c of formAssignedClasses) {
      if (!c.formTeacherId) continue;
      const list = formMap.get(c.formTeacherId) || [];
      list.push({ id: c.id, name: c.name, levelCode: c.levelCode });
      formMap.set(c.formTeacherId, list);
    }

    const staff = staffRaw.map((member) => ({
      ...member,
      formClasses: formMap.get(member.userId) || [],
    }));

    return { success: true, staff };
  }

  async getSchoolStaffDetails(schoolId: string, staffProfileId: string) {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { id: staffProfileId, schoolId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            avatarUrl: true,
            loginId: true,
            createdAt: true,
          },
        },
        department: {
          include: { unit: true },
        },
        assignedClasses: {
          include: {
            department: true,
            _count: {
              select: {
                studentProfiles: true,
                subjects: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        },
        assignedSubjects: {
          include: {
            schoolClass: true,
            department: true,
          },
          orderBy: { name: 'asc' },
        },
        classHistory: {
          include: {
            schoolClass: {
              select: { id: true, name: true, levelCode: true },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Staff / Teacher profile not found.');
    }

    const assignedClassIds = Array.from(
      new Set([
        ...profile.assignedClasses.map((c) => c.id),
        ...profile.assignedSubjects.map((s) => s.classId),
      ]),
    );

    const [membership, formClasses, totalStudentsReached, attendanceSessionsCount] =
      await Promise.all([
        this.prisma.membership.findFirst({
          where: { userId: profile.userId, schoolId },
          select: {
            status: true,
            mustChangePassword: true,
            loginId: true,
            createdAt: true,
          },
        }),
        this.prisma.schoolClass.findMany({
          where: { schoolId, formTeacherId: profile.userId },
          include: {
            department: true,
            _count: { select: { studentProfiles: true, subjects: true } },
          },
        }),
        assignedClassIds.length > 0
          ? this.prisma.studentProfile.count({
              where: { schoolId, classId: { in: assignedClassIds } },
            })
          : Promise.resolve(0),
        this.prisma.attendanceSession.count({
          where: { schoolId, teacherId: profile.userId },
        }),
      ]);

    return {
      success: true,
      staff: {
        ...profile,
        membership,
        formClasses,
        metrics: {
          assignedClassesCount: profile.assignedClasses.length,
          assignedSubjectsCount: profile.assignedSubjects.length,
          formClassesCount: formClasses.length,
          totalStudentsReached,
          attendanceSessionsCount,
        },
      },
    };
  }

  async updateSchoolStaff(
    schoolId: string,
    staffProfileId: string,
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
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { id: staffProfileId, schoolId },
      include: { user: true },
    });
    if (!profile) {
      throw new NotFoundException('Staff / Teacher profile not found.');
    }

    const userUpdateData: any = {};
    if (dto.fullName?.trim()) {
      userUpdateData.fullName = dto.fullName.trim();
    }
    if (dto.email !== undefined && dto.email.trim()) {
      const cleanEmail = dto.email.trim().toLowerCase();
      if (cleanEmail !== profile.user.email.toLowerCase()) {
        const existingEmail = await this.prisma.user.findUnique({
          where: { email: cleanEmail },
        });
        if (existingEmail && existingEmail.id !== profile.userId) {
          throw new BadRequestException(
            `Email "${cleanEmail}" is already in use by another account.`,
          );
        }
        userUpdateData.email = cleanEmail;
      }
    }

    if (Object.keys(userUpdateData).length > 0) {
      await this.prisma.user.update({
        where: { id: profile.userId },
        data: userUpdateData,
      });
    }

    let parsedYears: number | null | undefined = undefined;
    if (dto.yearsOfExperience !== undefined) {
      if (dto.yearsOfExperience === null || dto.yearsOfExperience === '') {
        parsedYears = null;
      } else {
        const n = Number(dto.yearsOfExperience);
        parsedYears = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      }
    }

    let parsedDateHired: Date | null | undefined = undefined;
    if (dto.dateHired !== undefined) {
      if (!dto.dateHired) {
        parsedDateHired = null;
      } else {
        const d = new Date(dto.dateHired);
        parsedDateHired = Number.isNaN(d.getTime()) ? null : d;
      }
    }

    const updated = await this.prisma.teacherProfile.update({
      where: { id: staffProfileId },
      data: {
        title: dto.title !== undefined ? dto.title?.trim() || null : undefined,
        departmentId:
          dto.departmentId !== undefined ? dto.departmentId || null : undefined,
        specialization:
          dto.specialization !== undefined
            ? dto.specialization?.trim() || null
            : undefined,
        educationLevel:
          dto.educationLevel !== undefined
            ? dto.educationLevel?.trim() || null
            : undefined,
        qualificationDetails:
          dto.qualificationDetails !== undefined
            ? dto.qualificationDetails?.trim() || null
            : undefined,
        phoneNumber:
          dto.phoneNumber !== undefined
            ? dto.phoneNumber?.trim() || null
            : undefined,
        gender:
          dto.gender !== undefined ? dto.gender?.trim() || null : undefined,
        address:
          dto.address !== undefined ? dto.address?.trim() || null : undefined,
        employmentType:
          dto.employmentType !== undefined
            ? dto.employmentType?.trim() || null
            : undefined,
        yearsOfExperience: parsedYears,
        dateHired: parsedDateHired,
        handlesAllSubjects:
          dto.handlesAllSubjects !== undefined
            ? Boolean(dto.handlesAllSubjects)
            : undefined,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            avatarUrl: true,
            loginId: true,
            createdAt: true,
          },
        },
        department: { include: { unit: true } },
        assignedClasses: true,
        assignedSubjects: true,
      },
    });

    return { success: true, teacherProfile: updated };
  }

  private buildSchoolIdPrefix(
    schoolName?: string | null,
    schoolCode?: string | null,
  ): string {
    const cleaned = String(schoolName || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 3) {
      return cleaned.slice(0, 10);
    }
    const codeCleaned = String(schoolCode || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (codeCleaned.length >= 2) {
      return codeCleaned.slice(0, 10);
    }
    return 'SCH';
  }

  private async isMemberIdTakenGlobally(
    candidate: string,
    exclude?: {
      teacherProfileId?: string;
      studentProfileId?: string;
      userId?: string;
    },
  ): Promise<boolean> {
    const [teacherHit, studentHit, userHit, membershipHit] = await Promise.all([
      this.prisma.teacherProfile.findFirst({
        where: {
          staffId: { equals: candidate, mode: 'insensitive' },
          ...(exclude?.teacherProfileId
            ? { id: { not: exclude.teacherProfileId } }
            : {}),
        },
        select: { id: true },
      }),
      this.prisma.studentProfile.findFirst({
        where: {
          matricOrAdmissionNo: { equals: candidate, mode: 'insensitive' },
          ...(exclude?.studentProfileId
            ? { id: { not: exclude.studentProfileId } }
            : {}),
        },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: {
          OR: [
            { loginId: { equals: candidate, mode: 'insensitive' } },
            { studentCode: { equals: candidate, mode: 'insensitive' } },
          ],
          ...(exclude?.userId ? { id: { not: exclude.userId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.membership.findFirst({
        where: {
          loginId: { equals: candidate, mode: 'insensitive' },
          ...(exclude?.userId ? { userId: { not: exclude.userId } } : {}),
        },
        select: { id: true },
      }),
    ]);

    return Boolean(teacherHit || studentHit || userHit || membershipHit);
  }

  private async generateUniqueMemberId(
    school: { name?: string | null; schoolCode?: string | null },
    roleCode: 'TCH' | 'STU',
  ): Promise<string> {
    const prefix = this.buildSchoolIdPrefix(school.name, school.schoolCode);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const bytes = randomBytes(5);
      let suffix = '';
      for (let i = 0; i < 5; i += 1) {
        suffix += alphabet[bytes[i] % alphabet.length];
      }
      const candidate = `${prefix}-${roleCode}-${suffix}`;
      const taken = await this.isMemberIdTakenGlobally(candidate);
      if (!taken) {
        return candidate;
      }
    }
    throw new BadRequestException(
      'Could not allocate a unique institution ID. Please try again.',
    );
  }

  async createSchoolStaff(
    schoolId: string,
    dto: {
      fullName: string;
      staffId?: string;
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
    if (!dto.fullName?.trim()) {
      throw new BadRequestException('Full name is required.');
    }

    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');

    const providedStaffId = dto.staffId?.trim().toUpperCase();
    let cleanStaffId = providedStaffId;
    if (cleanStaffId) {
      const taken = await this.isMemberIdTakenGlobally(cleanStaffId);
      if (taken) {
        throw new BadRequestException(
          `Staff ID "${cleanStaffId}" is already registered.`,
        );
      }
    } else {
      cleanStaffId = await this.generateUniqueMemberId(school, 'TCH');
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

    let parsedYears: number | null = null;
    if (dto.yearsOfExperience !== undefined && dto.yearsOfExperience !== null && dto.yearsOfExperience !== '') {
      const n = Number(dto.yearsOfExperience);
      if (Number.isFinite(n) && n >= 0) parsedYears = Math.floor(n);
    }

    let parsedDateHired: Date | null = null;
    if (dto.dateHired) {
      const d = new Date(dto.dateHired);
      if (!Number.isNaN(d.getTime())) parsedDateHired = d;
    }

    const cleanClassIds = Array.from(
      new Set([
        ...(dto.assignedClassIds || []),
        ...(dto.handlesAllSubjects && dto.formClassIds?.length ? dto.formClassIds : []),
      ]),
    );

    const teacherProfile = await this.prisma.teacherProfile.create({
      data: {
        userId: user.id,
        schoolId,
        staffId: cleanStaffId,
        title: dto.title?.trim() || 'Lecturer',
        departmentId: dto.departmentId || null,
        specialization: dto.specialization?.trim() || null,
        educationLevel: dto.educationLevel?.trim() || null,
        qualificationDetails: dto.qualificationDetails?.trim() || null,
        phoneNumber: dto.phoneNumber?.trim() || null,
        gender: dto.gender?.trim() || null,
        address: dto.address?.trim() || null,
        employmentType: dto.employmentType?.trim() || null,
        yearsOfExperience: parsedYears,
        dateHired: parsedDateHired,
        handlesAllSubjects: Boolean(dto.handlesAllSubjects),
        assignedClasses: cleanClassIds.length
          ? { connect: cleanClassIds.map((id) => ({ id })) }
          : undefined,
        assignedSubjects: dto.assignedSubjectIds?.length
          ? { connect: dto.assignedSubjectIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            avatarUrl: true,
            loginId: true,
            createdAt: true,
          },
        },
        department: { include: { unit: true } },
        assignedClasses: {
          include: {
            department: true,
            _count: { select: { studentProfiles: true, subjects: true } },
          },
        },
        assignedSubjects: {
          include: { schoolClass: true, department: true },
        },
      },
    });

    const formClasses = dto.formClassIds?.length
      ? await this.syncFormTeacherClasses(schoolId, user.id, dto.formClassIds)
      : [];

    await this.syncTeacherClassHistory(
      schoolId,
      teacherProfile.id,
      cleanClassIds,
      dto.assignedSubjectIds || [],
      dto.formClassIds || [],
      Boolean(dto.handlesAllSubjects),
    );

    return {
      success: true,
      teacherProfile: {
        ...teacherProfile,
        formClasses,
      },
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

  private async syncFormTeacherClasses(
    schoolId: string,
    userId: string,
    formClassIds: string[],
  ) {
    const uniqueFormIds = Array.from(new Set(formClassIds.filter(Boolean)));
    await this.prisma.schoolClass.updateMany({
      where: {
        schoolId,
        formTeacherId: userId,
        ...(uniqueFormIds.length > 0 ? { id: { notIn: uniqueFormIds } } : {}),
      },
      data: { formTeacherId: null },
    });

    if (uniqueFormIds.length > 0) {
      await this.prisma.schoolClass.updateMany({
        where: { schoolId, id: { in: uniqueFormIds } },
        data: { formTeacherId: userId },
      });
    }

    return this.prisma.schoolClass.findMany({
      where: { schoolId, formTeacherId: userId },
      select: { id: true, name: true, levelCode: true },
    });
  }

  private async syncTeacherClassHistory(
    schoolId: string,
    teacherProfileId: string,
    assignedClassIds: string[],
    assignedSubjectIds: string[],
    formClassIds: string[] = [],
    handlesAllSubjects = false,
  ) {
    const subjects = assignedSubjectIds.length
      ? await this.prisma.schoolSubject.findMany({
          where: { schoolId, id: { in: assignedSubjectIds } },
          select: { classId: true, name: true },
        })
      : [];

    const activeClassIds = new Set<string>([...assignedClassIds, ...formClassIds]);
    const subjByClass = new Map<string, string[]>();
    for (const s of subjects) {
      activeClassIds.add(s.classId);
      const list = subjByClass.get(s.classId) || [];
      list.push(s.name);
      subjByClass.set(s.classId, list);
    }

    const resolveRoleLabel = (cid: string) => {
      const isForm = formClassIds.includes(cid);
      const isFullClass = handlesAllSubjects && assignedClassIds.includes(cid);
      if (isForm && isFullClass) return 'Form & Full-Class Teacher';
      if (isForm) return 'Form Teacher';
      if (isFullClass) return 'Class Teacher (All Subjects)';
      if (assignedClassIds.includes(cid)) return 'Class Teacher';
      return 'Subject Teacher';
    };

    const openRows = await this.prisma.classTeacherAssignmentHistory.findMany({
      where: { schoolId, teacherProfileId, unassignedAt: null },
    });

    const openClassIds = new Set<string>();
    const now = new Date();
    for (const row of openRows) {
      if (!activeClassIds.has(row.classId)) {
        await this.prisma.classTeacherAssignmentHistory.update({
          where: { id: row.id },
          data: { unassignedAt: now },
        });
      } else {
        openClassIds.add(row.classId);
        const subjSummary =
          handlesAllSubjects && assignedClassIds.includes(row.classId)
            ? 'All Class Subjects'
            : (subjByClass.get(row.classId) || []).join(', ');
        const nextRole = resolveRoleLabel(row.classId);
        if ((subjSummary && subjSummary !== row.subjectSummary) || nextRole !== row.roleLabel) {
          await this.prisma.classTeacherAssignmentHistory.update({
            where: { id: row.id },
            data: {
              roleLabel: nextRole,
              ...(subjSummary ? { subjectSummary: subjSummary } : {}),
            },
          });
        }
      }
    }

    for (const cid of activeClassIds) {
      if (!openClassIds.has(cid)) {
        const subjSummary =
          handlesAllSubjects && assignedClassIds.includes(cid)
            ? 'All Class Subjects'
            : (subjByClass.get(cid) || []).join(', ');
        await this.prisma.classTeacherAssignmentHistory.create({
          data: {
            schoolId,
            classId: cid,
            teacherProfileId,
            roleLabel: resolveRoleLabel(cid),
            subjectSummary: subjSummary || null,
          },
        });
      }
    }
  }

  async assignTeacherCourses(
    schoolId: string,
    teacherProfileId: string,
    dto: {
      classIds?: string[];
      subjectIds?: string[];
      formClassIds?: string[];
      handlesAllSubjects?: boolean;
    },
  ) {
    const profile = await this.prisma.teacherProfile.findFirst({
      where: { id: teacherProfileId, schoolId },
      include: {
        assignedClasses: { select: { id: true } },
        assignedSubjects: { select: { id: true } },
      },
    });
    if (!profile) throw new NotFoundException('Teacher profile not found.');

    const existingFormClasses = await this.prisma.schoolClass.findMany({
      where: { schoolId, formTeacherId: profile.userId },
      select: { id: true },
    });

    const nextHandlesAll =
      dto.handlesAllSubjects !== undefined
        ? Boolean(dto.handlesAllSubjects)
        : profile.handlesAllSubjects;
    const nextFormClassIds =
      dto.formClassIds !== undefined
        ? dto.formClassIds
        : existingFormClasses.map((c) => c.id);
    const nextClassIds = Array.from(
      new Set([
        ...(dto.classIds ?? profile.assignedClasses.map((c) => c.id)),
        ...(nextHandlesAll && nextFormClassIds.length > 0 && dto.classIds === undefined
          ? nextFormClassIds
          : []),
      ]),
    );
    const nextSubjectIds =
      dto.subjectIds ?? profile.assignedSubjects.map((s) => s.id);

    const updated = await this.prisma.teacherProfile.update({
      where: { id: teacherProfileId },
      data: {
        handlesAllSubjects:
          dto.handlesAllSubjects !== undefined ? nextHandlesAll : undefined,
        assignedClasses:
          dto.classIds !== undefined
            ? { set: nextClassIds.map((id) => ({ id })) }
            : undefined,
        assignedSubjects: dto.subjectIds
          ? { set: dto.subjectIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        user: true,
        assignedClasses: true,
        assignedSubjects: true,
      },
    });

    const formClasses =
      dto.formClassIds !== undefined
        ? await this.syncFormTeacherClasses(schoolId, profile.userId, nextFormClassIds)
        : existingFormClasses;

    await this.syncTeacherClassHistory(
      schoolId,
      teacherProfileId,
      nextClassIds,
      nextSubjectIds,
      nextFormClassIds,
      nextHandlesAll,
    );

    return {
      success: true,
      teacherProfile: {
        ...updated,
        formClasses,
      },
    };
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

  private normalizeStudentAge(raw?: number | string | null): number | null {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 120) return null;
    return Math.floor(n);
  }

  async createSchoolStudent(
    schoolId: string,
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
    if (!dto.fullName?.trim()) {
      throw new BadRequestException('Student full name is required.');
    }

    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');

    const providedMatric = dto.matricOrAdmissionNo?.trim().toUpperCase();
    let cleanMatric = providedMatric;
    if (cleanMatric) {
      const taken = await this.isMemberIdTakenGlobally(cleanMatric);
      if (taken) {
        throw new BadRequestException(
          `Student ID "${cleanMatric}" is already in use.`,
        );
      }
    } else {
      cleanMatric = await this.generateUniqueMemberId(school, 'STU');
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
        age: this.normalizeStudentAge(dto.age),
        guardianName: dto.guardianName?.trim() || null,
        guardianRelationship: dto.guardianRelationship?.trim() || null,
        guardianEmail: dto.guardianEmail?.trim()?.toLowerCase() || null,
        guardianPhone: dto.guardianPhone?.trim() || null,
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
    return this.updateSchoolStudent(schoolId, studentProfileId, dto);
  }

  async updateSchoolStudent(
    schoolId: string,
    studentProfileId: string,
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
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentProfileId, schoolId },
      include: { user: true },
    });
    if (!profile) {
      throw new NotFoundException('Student profile not found in this institution.');
    }

    const cleanMatric = dto.matricOrAdmissionNo?.trim().toUpperCase();
    if (cleanMatric && cleanMatric !== profile.matricOrAdmissionNo) {
      const conflict = await this.isMemberIdTakenGlobally(cleanMatric, {
        studentProfileId,
        userId: profile.userId,
      });
      if (conflict) {
        throw new BadRequestException(
          `ID "${cleanMatric}" is already in use.`,
        );
      }
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
      if (dto.departmentId === undefined && !resolvedDeptId && cls.departmentId) {
        resolvedDeptId = cls.departmentId;
      }
    }

    const [updatedProfile] = await Promise.all([
      this.prisma.studentProfile.update({
        where: { id: studentProfileId },
        data: {
          ...(cleanMatric ? { matricOrAdmissionNo: cleanMatric } : {}),
          classId: resolvedClassId || null,
          departmentId: resolvedDeptId || null,
          level: resolvedLevel,
          ...(dto.age !== undefined ? { age: this.normalizeStudentAge(dto.age) } : {}),
          ...(dto.guardianName !== undefined
            ? { guardianName: dto.guardianName?.trim() || null }
            : {}),
          ...(dto.guardianRelationship !== undefined
            ? { guardianRelationship: dto.guardianRelationship?.trim() || null }
            : {}),
          ...(dto.guardianEmail !== undefined
            ? { guardianEmail: dto.guardianEmail?.trim()?.toLowerCase() || null }
            : {}),
          ...(dto.guardianPhone !== undefined
            ? { guardianPhone: dto.guardianPhone?.trim() || null }
            : {}),
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
          ...(dto.fullName?.trim() ? { fullName: dto.fullName.trim() } : {}),
          ...(dto.email?.trim() ? { email: dto.email.trim().toLowerCase() } : {}),
          ...(cleanMatric ? { loginId: cleanMatric } : {}),
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
        age?: number | string | null;
        guardianName?: string;
        guardianRelationship?: string;
        guardianEmail?: string;
        guardianPhone?: string;
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
          age: row.age,
          guardianName: row.guardianName,
          guardianRelationship: row.guardianRelationship,
          guardianEmail: row.guardianEmail,
          guardianPhone: row.guardianPhone,
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
