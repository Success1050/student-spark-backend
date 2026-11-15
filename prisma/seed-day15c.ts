import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const COMMON_PASSWORD = 'SparkPass2026!';

async function ensureUser(params: {
  email: string;
  fullName: string;
  role: 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'SCHOOL_FINANCE';
  loginId: string;
  schoolId: string;
  passwordHash: string;
  avatarUrl?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: params.fullName,
        role: params.role,
        loginId: params.loginId,
        schoolId: params.schoolId,
        passwordHash: params.passwordHash,
        mustChangePassword: false,
        avatarUrl: params.avatarUrl ?? existing.avatarUrl,
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        email: params.email,
        fullName: params.fullName,
        role: params.role,
        loginId: params.loginId,
        schoolId: params.schoolId,
        passwordHash: params.passwordHash,
        mustChangePassword: false,
        avatarUrl: params.avatarUrl,
        referralCode: `REF-${Math.floor(100000 + Math.random() * 900000)}`,
      },
    });
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, schoolId: params.schoolId },
  });
  if (!membership) {
    await prisma.membership.create({
      data: {
        userId: user.id,
        schoolId: params.schoolId,
        role: params.role,
      },
    });
  }
  return user;
}

async function main() {
  console.log('=== Seeding Day 15C: Tertiary Standings (GPA/CGPA) & Full SUG Ecosystem ===');
  const passwordHash = await bcrypt.hash(COMMON_PASSWORD, 10);

  // 1. Primary Tertiary Institution: FUTO
  let futo = await prisma.school.findUnique({ where: { schoolCode: 'FUTO-01' } });
  if (!futo) {
    futo = await prisma.school.create({
      data: {
        name: 'Federal University of Technology, Owerri',
        slug: 'futo',
        schoolCode: 'FUTO-01',
        institutionType: 'UNIVERSITY',
        masterSecretKey: 'SEC-SPK-FUTO-9A8B7C6D5E4F3A2B',
        contactEmail: 'admin@futo.studentspark.ng',
      },
    });
  }

  // 2. Academic Session & Terms (Previous + Current so Semester GPA & Cumulative CGPA differ meaningfully)
  let currentSession = await prisma.academicSession.findFirst({
    where: { schoolId: futo.id, isCurrent: true },
  });
  if (!currentSession) {
    currentSession = await prisma.academicSession.create({
      data: {
        schoolId: futo.id,
        name: '2025/2026 Academic Session',
        isCurrent: true,
      },
    });
  }

  let currentTerm = await prisma.academicTerm.findFirst({
    where: { sessionId: currentSession.id, isCurrent: true },
  });
  if (!currentTerm) {
    currentTerm = await prisma.academicTerm.create({
      data: {
        sessionId: currentSession.id,
        name: 'Second Semester (2025/2026)',
        isCurrent: true,
        isEnabled: true,
        isClosed: false,
      },
    });
  }

  let prevTerm = await prisma.academicTerm.findFirst({
    where: {
      sessionId: currentSession.id,
      id: { not: currentTerm.id },
    },
  });
  if (!prevTerm) {
    prevTerm = await prisma.academicTerm.create({
      data: {
        sessionId: currentSession.id,
        name: 'First Semester (2025/2026)',
        isCurrent: false,
        isEnabled: true,
        isClosed: true,
      },
    });
  }

  // 3. Faculties & Departments
  const ensureUnit = async (name: string, code: string) => {
    const found = await prisma.academicUnit.findFirst({
      where: { schoolId: futo.id, name },
    });
    if (found) return found;
    return prisma.academicUnit.create({
      data: { schoolId: futo.id, name, code, unitType: 'FACULTY' },
    });
  };

  const facEng = await ensureUnit('School of Engineering and Engineering Technology', 'SEET');
  const facComp = await ensureUnit('School of Information & Communication Technology', 'SICT');

  const ensureDept = async (unitId: string, name: string, code: string) => {
    const found = await prisma.department.findFirst({
      where: { schoolId: futo.id, name },
    });
    if (found) {
      return prisma.department.update({
        where: { id: found.id },
        data: { unitId, code },
      });
    }
    return prisma.department.create({
      data: { schoolId: futo.id, unitId, name, code },
    });
  };

  const deptEee = await ensureDept(facEng.id, 'Electrical & Electronic Engineering', 'EEE');
  const deptMee = await ensureDept(facEng.id, 'Mechanical Engineering', 'MEE');
  const deptCsc = await ensureDept(facComp.id, 'Computer Science', 'CSC');

  // 4. Levels / Cohorts (SchoolClass)
  const ensureClass = async (
    departmentId: string,
    name: string,
    levelCode: string,
    inviteCode: string,
  ) => {
    const found = await prisma.schoolClass.findFirst({
      where: { schoolId: futo.id, name },
    });
    if (found) {
      return prisma.schoolClass.update({
        where: { id: found.id },
        data: { departmentId, levelCode },
      });
    }
    return prisma.schoolClass.create({
      data: {
        schoolId: futo.id,
        departmentId,
        name,
        levelCode,
        termOrSemester: 'Second Semester',
        inviteCode,
      },
    });
  };

  const clsEee200 = await ensureClass(deptEee.id, 'EEE 200 Level', '200L', 'FUTO-EEE-200L');
  const clsEee300 = await ensureClass(deptEee.id, 'EEE 300 Level', '300L', 'FUTO-EEE-300L');
  const clsMee200 = await ensureClass(deptMee.id, 'MEE 200 Level', '200L', 'FUTO-MEE-200L');
  const clsCsc200 = await ensureClass(deptCsc.id, 'CSC 200 Level', '200L', 'FUTO-CSC-200L');
  const clsCsc300 = await ensureClass(deptCsc.id, 'CSC 300 Level', '300L', 'FUTO-CSC-300L');

  // 5. Lecturers & Students
  const adminFuto = await ensureUser({
    email: 'admin@futo.studentspark.ng',
    fullName: 'Prof. Augustine Nnamdi',
    role: 'SCHOOL_ADMIN',
    loginId: 'FUTO-ADMIN-01',
    schoolId: futo.id,
    passwordHash,
  });

  const lecturerAde = await ensureUser({
    email: 'lecturer.ade@futo.studentspark.ng',
    fullName: 'Dr. Adeyemi Balogun',
    role: 'TEACHER',
    loginId: 'STAFF/EEE/2020/042',
    schoolId: futo.id,
    passwordHash,
  });

  const lecturerOkoro = await ensureUser({
    email: 'lecturer.csc@futo.studentspark.ng',
    fullName: 'Dr. Chinedu Okoro',
    role: 'TEACHER',
    loginId: 'STAFF/CSC/2019/018',
    schoolId: futo.id,
    passwordHash,
  });

  const studentDefs = [
    {
      email: 'student.chidi@futo.studentspark.ng',
      fullName: 'Chidi Chukwuma',
      matric: 'FUTO/2023/104928',
      deptId: deptEee.id,
      classId: clsEee200.id,
      level: '200L',
      avatarUrl: 'https://randomuser.me/api/portraits/men/32.jpg',
    },
    {
      email: 'student.voter@futo.studentspark.ng',
      fullName: 'Ngozi Eze',
      matric: 'FUTO/2023/209977',
      deptId: deptEee.id,
      classId: clsEee200.id,
      level: '200L',
      avatarUrl: 'https://randomuser.me/api/portraits/women/44.jpg',
    },
    {
      email: 'courserep.eee@futo.studentspark.ng',
      fullName: 'Emeka Okafor',
      matric: 'FUTO/2023/204422',
      deptId: deptEee.id,
      classId: clsEee200.id,
      level: '200L',
      avatarUrl: 'https://randomuser.me/api/portraits/men/45.jpg',
    },
    {
      email: 'eee.president@futo.studentspark.ng',
      fullName: 'Zainab Bello',
      matric: 'FUTO/2022/101190',
      deptId: deptEee.id,
      classId: clsEee300.id,
      level: '300L',
      avatarUrl: 'https://randomuser.me/api/portraits/women/65.jpg',
    },
    {
      email: 'seet.president@futo.studentspark.ng',
      fullName: 'Tobi Ogunleye',
      matric: 'FUTO/2023/205544',
      deptId: deptMee.id,
      classId: clsMee200.id,
      level: '200L',
      avatarUrl: 'https://randomuser.me/api/portraits/men/22.jpg',
    },
    {
      email: 'student.ibrahim@futo.studentspark.ng',
      fullName: 'Ibrahim Musa',
      matric: 'FUTO/2023/207712',
      deptId: deptMee.id,
      classId: clsMee200.id,
      level: '200L',
      avatarUrl: 'https://randomuser.me/api/portraits/men/75.jpg',
    },
    {
      email: 'student.kemi@futo.studentspark.ng',
      fullName: 'Kemi Adebayo',
      matric: 'FUTO/2023/206633',
      deptId: deptCsc.id,
      classId: clsCsc200.id,
      level: '200L',
      avatarUrl: 'https://randomuser.me/api/portraits/women/28.jpg',
    },
    {
      email: 'sug.finsec@futo.studentspark.ng',
      fullName: 'Adaeze Nwankwo',
      matric: 'FUTO/2022/208811',
      deptId: deptCsc.id,
      classId: clsCsc300.id,
      level: '300L',
      avatarUrl: 'https://randomuser.me/api/portraits/women/17.jpg',
    },
    {
      email: 'student.eee300@futo.studentspark.ng',
      fullName: 'Samuel Dike',
      matric: 'FUTO/2022/109944',
      deptId: deptEee.id,
      classId: clsEee300.id,
      level: '300L',
      avatarUrl: 'https://randomuser.me/api/portraits/men/54.jpg',
    },
  ];

  const studentsByEmail: Record<string, any> = {};
  for (const s of studentDefs) {
    const user = await ensureUser({
      email: s.email,
      fullName: s.fullName,
      role: 'STUDENT',
      loginId: s.matric,
      schoolId: futo.id,
      passwordHash,
      avatarUrl: s.avatarUrl,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { classId: s.classId },
    });
    const prof = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
    if (prof) {
      await prisma.studentProfile.update({
        where: { userId: user.id },
        data: {
          schoolId: futo.id,
          departmentId: s.deptId,
          classId: s.classId,
          level: s.level,
          matricOrAdmissionNo: s.matric,
        },
      });
    } else {
      await prisma.studentProfile.create({
        data: {
          userId: user.id,
          schoolId: futo.id,
          departmentId: s.deptId,
          classId: s.classId,
          level: s.level,
          matricOrAdmissionNo: s.matric,
        },
      });
    }

    await prisma.classEnrollment.upsert({
      where: { classId_studentId: { classId: s.classId, studentId: user.id } },
      update: {},
      create: { classId: s.classId, studentId: user.id },
    });

    studentsByEmail[s.email] = { user, ...s };
  }

  // 6. Courses (SchoolSubject) + Multi-Term Grades (Semester GPA & Cumulative CGPA)
  const ensureCourse = async (params: {
    classId: string;
    departmentId: string;
    courseCode: string;
    name: string;
    creditUnits: number;
    teacherId?: string;
  }) => {
    const teacherId = params.teacherId || lecturerAde.id;
    const found = await prisma.schoolSubject.findFirst({
      where: { schoolId: futo.id, courseCode: params.courseCode, classId: params.classId },
    });
    if (found) {
      return prisma.schoolSubject.update({
        where: { id: found.id },
        data: { teacherId, departmentId: params.departmentId, creditUnits: params.creditUnits },
      });
    }
    return prisma.schoolSubject.create({
      data: {
        schoolId: futo.id,
        classId: params.classId,
        departmentId: params.departmentId,
        teacherId,
        courseCode: params.courseCode,
        name: params.name,
        creditUnits: params.creditUnits,
      },
    });
  };

  const eee201 = await ensureCourse({
    classId: clsEee200.id,
    departmentId: deptEee.id,
    courseCode: 'EEE 201',
    name: 'Circuit Theory I',
    creditUnits: 3,
    teacherId: lecturerAde.id,
  });
  const eee203 = await ensureCourse({
    classId: clsEee200.id,
    departmentId: deptEee.id,
    courseCode: 'EEE 203',
    name: 'Engineering Mathematics II',
    creditUnits: 4,
    teacherId: lecturerAde.id,
  });
  const eee301 = await ensureCourse({
    classId: clsEee300.id,
    departmentId: deptEee.id,
    courseCode: 'EEE 301',
    name: 'Power Electronics',
    creditUnits: 3,
    teacherId: lecturerOkoro.id,
  });
  const mee201 = await ensureCourse({
    classId: clsMee200.id,
    departmentId: deptMee.id,
    courseCode: 'MEE 201',
    name: 'Applied Mechanics',
    creditUnits: 3,
    teacherId: lecturerOkoro.id,
  });
  const csc201 = await ensureCourse({
    classId: clsCsc200.id,
    departmentId: deptCsc.id,
    courseCode: 'CSC 201',
    name: 'Data Structures & Algorithms',
    creditUnits: 3,
    teacherId: lecturerOkoro.id,
  });
  const csc301 = await ensureCourse({
    classId: clsCsc300.id,
    departmentId: deptCsc.id,
    courseCode: 'CSC 301',
    name: 'Operating Systems',
    creditUnits: 3,
    teacherId: lecturerOkoro.id,
  });

  // Bind Lecturer Ade specifically to EEE Department & 200L EEE assigned courses/level
  const existingAdeProfile = await prisma.teacherProfile.findUnique({
    where: { userId: lecturerAde.id },
  });
  if (existingAdeProfile) {
    await prisma.teacherProfile.update({
      where: { userId: lecturerAde.id },
      data: {
        schoolId: futo.id,
        departmentId: deptEee.id,
        title: 'Senior Lecturer',
        assignedClasses: { set: [{ id: clsEee200.id }] },
        assignedSubjects: { set: [{ id: eee201.id }, { id: eee203.id }] },
      },
    });
  } else {
    await prisma.teacherProfile.create({
      data: {
        userId: lecturerAde.id,
        schoolId: futo.id,
        departmentId: deptEee.id,
        staffId: 'STAFF/EEE/2020/042',
        title: 'Senior Lecturer',
        assignedClasses: { connect: [{ id: clsEee200.id }] },
        assignedSubjects: { connect: [{ id: eee201.id }, { id: eee203.id }] },
      },
    });
  }

  const existingOkoroProfile = await prisma.teacherProfile.findUnique({
    where: { userId: lecturerOkoro.id },
  });
  if (!existingOkoroProfile) {
    await prisma.teacherProfile.create({
      data: {
        userId: lecturerOkoro.id,
        schoolId: futo.id,
        departmentId: deptCsc.id,
        staffId: 'STAFF/CSC/2019/018',
        title: 'Lecturer I',
        assignedClasses: { connect: [{ id: clsCsc200.id }, { id: clsCsc300.id }] },
        assignedSubjects: { connect: [{ id: csc201.id }, { id: csc301.id }] },
      },
    });
  }

  const toGradeMeta = (total: number) => {
    if (total >= 70) return { letter: 'A', gp: 5.0 };
    if (total >= 60) return { letter: 'B', gp: 4.0 };
    if (total >= 50) return { letter: 'C', gp: 3.0 };
    if (total >= 45) return { letter: 'D', gp: 2.0 };
    if (total >= 40) return { letter: 'E', gp: 1.0 };
    return { letter: 'F', gp: 0.0 };
  };

  const upsertGrade = async (
    termId: string,
    classId: string,
    subjectId: string,
    studentId: string,
    totalScore: number,
  ) => {
    const meta = toGradeMeta(totalScore);
    await prisma.studentSubjectGrade.upsert({
      where: {
        termId_subjectId_studentId: { termId, subjectId, studentId },
      },
      update: {
        classId,
        totalScore,
        letterGrade: meta.letter,
        gradePoint: meta.gp,
        scoresJson: { quiz: Math.round(totalScore * 0.3), exam: Math.round(totalScore * 0.7) },
      },
      create: {
        schoolId: futo.id,
        termId,
        classId,
        subjectId,
        studentId,
        totalScore,
        letterGrade: meta.letter,
        gradePoint: meta.gp,
        scoresJson: { quiz: Math.round(totalScore * 0.3), exam: Math.round(totalScore * 0.7) },
      },
    });
  };

  // Current Semester Grades (Live GPA)
  const chidi = studentsByEmail['student.chidi@futo.studentspark.ng'].user;
  const ngozi = studentsByEmail['student.voter@futo.studentspark.ng'].user;
  const emeka = studentsByEmail['courserep.eee@futo.studentspark.ng'].user;
  const tobi = studentsByEmail['seet.president@futo.studentspark.ng'].user;
  const ibrahim = studentsByEmail['student.ibrahim@futo.studentspark.ng'].user;
  const kemi = studentsByEmail['student.kemi@futo.studentspark.ng'].user;
  const adaeze = studentsByEmail['sug.finsec@futo.studentspark.ng'].user;

  // Notice: Ngozi leads Current Semester GPA (5.00), while Chidi led 1st Semester so Cumulative CGPA stays close/competitive!
  await upsertGrade(currentTerm.id, clsEee200.id, eee201.id, ngozi.id, 84);
  await upsertGrade(currentTerm.id, clsEee200.id, eee203.id, ngozi.id, 78);
  await upsertGrade(currentTerm.id, clsEee200.id, eee201.id, chidi.id, 74);
  await upsertGrade(currentTerm.id, clsEee200.id, eee203.id, chidi.id, 66);
  await upsertGrade(currentTerm.id, clsEee200.id, eee201.id, emeka.id, 62);
  await upsertGrade(currentTerm.id, clsEee200.id, eee203.id, emeka.id, 58);

  // Previous Semester Grades (Cumulative CGPA): Chidi had straight A's while Ngozi had B/C so Cumulative CGPA flips!
  await upsertGrade(prevTerm.id, clsEee200.id, eee201.id, chidi.id, 88);
  await upsertGrade(prevTerm.id, clsEee200.id, eee203.id, chidi.id, 82);
  await upsertGrade(prevTerm.id, clsEee200.id, eee201.id, ngozi.id, 56);
  await upsertGrade(prevTerm.id, clsEee200.id, eee203.id, ngozi.id, 63);
  await upsertGrade(prevTerm.id, clsEee200.id, eee201.id, emeka.id, 71);

  // Other SEET (EEE 300L & MEE 200L) & SICT (CSC 200L/300L) students
  const zainabStu = studentsByEmail['eee.president@futo.studentspark.ng'].user;
  const samuelStu = studentsByEmail['student.eee300@futo.studentspark.ng'].user;
  await upsertGrade(currentTerm.id, clsEee300.id, eee301.id, zainabStu.id, 85);
  await upsertGrade(prevTerm.id, clsEee300.id, eee301.id, zainabStu.id, 78);
  await upsertGrade(currentTerm.id, clsEee300.id, eee301.id, samuelStu.id, 69);
  await upsertGrade(prevTerm.id, clsEee300.id, eee301.id, samuelStu.id, 74);

  await upsertGrade(currentTerm.id, clsMee200.id, mee201.id, tobi.id, 79);
  await upsertGrade(prevTerm.id, clsMee200.id, mee201.id, tobi.id, 73);
  await upsertGrade(currentTerm.id, clsMee200.id, mee201.id, ibrahim.id, 65);
  await upsertGrade(currentTerm.id, clsCsc200.id, csc201.id, kemi.id, 86);
  await upsertGrade(prevTerm.id, clsCsc200.id, csc201.id, kemi.id, 76);
  await upsertGrade(currentTerm.id, clsCsc300.id, csc301.id, adaeze.id, 81);
  await upsertGrade(prevTerm.id, clsCsc300.id, csc301.id, adaeze.id, 79);

  // Course Rep Delegation for Emeka
  await prisma.courseRepAssignment.upsert({
    where: {
      schoolId_classId_subjectId_studentId: {
        schoolId: futo.id,
        classId: clsEee200.id,
        subjectId: eee201.id,
        studentId: emeka.id,
      },
    },
    update: { isActive: true, departmentId: deptEee.id },
    create: {
      schoolId: futo.id,
      classId: clsEee200.id,
      subjectId: eee201.id,
      departmentId: deptEee.id,
      studentId: emeka.id,
      delegatedById: lecturerAde.id,
      title: 'EEE 200L Course Representative',
      isActive: true,
    },
  });

  // 7. SUG Role Configs for FUTO
  const upsertSugRole = async (data: {
    title: string;
    tier: string;
    unitId?: string | null;
    departmentId?: string | null;
    description: string;
    dueForElection: boolean;
    isSelectionOpen?: boolean;
    eligibleLevelsJson?: string[];
    maxEndorsementWinners?: number;
    canViewFinanceReadOnly: boolean;
    canPostPublicUpdates: boolean;
    canPostOpportunities: boolean;
    canManageWelfare: boolean;
    canPostInternal: boolean;
    sortOrder: number;
  }) => {
    const existing = await prisma.sugRoleConfig.findFirst({
      where: { schoolId: futo.id, title: data.title },
    });
    if (existing) {
      return prisma.sugRoleConfig.update({ where: { id: existing.id }, data });
    }
    return prisma.sugRoleConfig.create({ data: { schoolId: futo.id, ...data } });
  };

  const rolePres = await upsertSugRole({
    title: 'SUG President',
    tier: 'SUG_CENTRAL',
    description: 'Chief Executive of the Student Union Government; leads union advocacy & views Finance strictly Read-Only.',
    dueForElection: true,
    isSelectionOpen: false,
    eligibleLevelsJson: [],
    canViewFinanceReadOnly: true,
    canPostPublicUpdates: true,
    canPostOpportunities: true,
    canManageWelfare: true,
    canPostInternal: true,
    sortOrder: 1,
  });
  const roleFinSec = await upsertSugRole({
    title: 'SUG Financial Secretary',
    tier: 'SUG_CENTRAL',
    description: 'Audits SUG union dues & bursary schedules (Read-Only Executive view).',
    dueForElection: false,
    isSelectionOpen: false,
    eligibleLevelsJson: [],
    canViewFinanceReadOnly: true,
    canPostPublicUpdates: true,
    canPostOpportunities: false,
    canManageWelfare: false,
    canPostInternal: true,
    sortOrder: 2,
  });
  const roleFacPres = await upsertSugRole({
    title: 'Faculty President (SEET)',
    tier: 'FACULTY',
    unitId: facEng.id,
    description: 'Leads School of Engineering & Engineering Technology students. Peer endorsement configured for 200L SEET students.',
    dueForElection: true,
    isSelectionOpen: true,
    eligibleLevelsJson: ['200L'],
    maxEndorsementWinners: 2,
    canViewFinanceReadOnly: false,
    canPostPublicUpdates: true,
    canPostOpportunities: true,
    canManageWelfare: true,
    canPostInternal: true,
    sortOrder: 3,
  });
  const roleDeptPres = await upsertSugRole({
    title: 'Departmental President (EEE)',
    tier: 'DEPARTMENT',
    departmentId: deptEee.id,
    description: 'Heads Electrical & Electronic Engineering association. Only 300L EEE students can endorse nominees.',
    dueForElection: true,
    isSelectionOpen: true,
    eligibleLevelsJson: ['300L'],
    maxEndorsementWinners: 2,
    canViewFinanceReadOnly: false,
    canPostPublicUpdates: true,
    canPostOpportunities: false,
    canManageWelfare: true,
    canPostInternal: true,
    sortOrder: 4,
  });

  // 8. Appoint Office Holders
  const zainab = studentsByEmail['eee.president@futo.studentspark.ng'].user;

  const ensureHolder = async (roleId: string, userId: string, opts: any) => {
    const existing = await prisma.sugOfficeHolder.findFirst({
      where: { schoolId: futo.id, roleId, userId },
    });
    if (existing) {
      return prisma.sugOfficeHolder.update({ where: { id: existing.id }, data: { isActive: true, ...opts } });
    }
    return prisma.sugOfficeHolder.create({
      data: {
        schoolId: futo.id,
        roleId,
        userId,
        appointedById: adminFuto.id,
        tenureLabel: '2025/2026',
        isActive: true,
        ...opts,
      },
    });
  };

  await ensureHolder(rolePres.id, chidi.id, {
    photoUrl: 'https://randomuser.me/api/portraits/men/32.jpg',
    manifestoOrBio: 'Digital Campus Transparency, Free Past-Question Access & Welfare First.',
  });
  await ensureHolder(roleFinSec.id, adaeze.id, {
    photoUrl: 'https://randomuser.me/api/portraits/women/17.jpg',
    manifestoOrBio: 'Open Financial Audits & Clear SUG Dues Accountability.',
  });
  await ensureHolder(roleFacPres.id, tobi.id, {
    unitId: facEng.id,
    photoUrl: 'https://randomuser.me/api/portraits/men/22.jpg',
    manifestoOrBio: 'Engineering Lab Upgrades & Practical Manual Subsidies.',
  });
  await ensureHolder(roleDeptPres.id, zainab.id, {
    departmentId: deptEee.id,
    photoUrl: 'https://randomuser.me/api/portraits/women/65.jpg',
    manifestoOrBio: 'EEE Mentorship, Hackathon Squads & Exam Clinic.',
  });

  // 9. Seed 2 LIVE Elections with Attractive Portraits, Dept, Faculty, Level & Starter Votes
  const ensureElectionWithCandidates = async (params: {
    roleId: string;
    title: string;
    description: string;
    scopeTier: string;
    unitId?: string;
    candidates: Array<{
      fullName: string;
      photoUrl: string;
      departmentName: string;
      facultyName: string;
      levelCode: string;
      manifesto: string;
      voteCount: number;
    }>;
  }) => {
    let election = await prisma.sugElection.findFirst({
      where: { schoolId: futo.id, title: params.title },
    });
    if (!election) {
      election = await prisma.sugElection.create({
        data: {
          schoolId: futo.id,
          roleId: params.roleId,
          title: params.title,
          description: params.description,
          scopeTier: params.scopeTier,
          unitId: params.unitId ?? null,
          status: 'LIVE',
          startsAt: new Date(Date.now() - 3600 * 1000 * 3),
          endsAt: new Date(Date.now() + 3600 * 1000 * 24),
          createdById: adminFuto.id,
        },
      });
    } else {
      election = await prisma.sugElection.update({
        where: { id: election.id },
        data: { status: 'LIVE' },
      });
    }

    const existingCount = await prisma.sugElectionCandidate.count({
      where: { electionId: election.id },
    });
    if (existingCount === 0) {
      for (const c of params.candidates) {
        await prisma.sugElectionCandidate.create({
          data: { electionId: election.id, ...c },
        });
      }
    }
  };

  await ensureElectionWithCandidates({
    roleId: rolePres.id,
    title: '2026/2027 SUG President Live Election',
    description: 'Every verified student gets 1 live vote. Results update in real time for students and lecturers.',
    scopeTier: 'SUG_CENTRAL',
    candidates: [
      {
        fullName: 'Daniel Chukwuemeka',
        photoUrl: 'https://randomuser.me/api/portraits/men/54.jpg',
        departmentName: 'Computer Science',
        facultyName: 'School of ICT (SICT)',
        levelCode: '400L',
        manifesto: 'Automated shuttle bus tracker, expanded 24hr hostel solar backup, and open SUG bursary ledger.',
        voteCount: 54,
      },
      {
        fullName: 'Chisom Opara',
        photoUrl: 'https://randomuser.me/api/portraits/women/52.jpg',
        departmentName: 'Electrical & Electronic Engineering',
        facultyName: 'School of Engineering (SEET)',
        levelCode: '400L',
        manifesto: 'Campus Wi-Fi hubs at every lecture theatre, subsidized lab manuals, and swift welfare dispute resolution.',
        voteCount: 49,
      },
      {
        fullName: 'Samuel Adekunle',
        photoUrl: 'https://randomuser.me/api/portraits/men/11.jpg',
        departmentName: 'Mechanical Engineering',
        facultyName: 'School of Engineering (SEET)',
        levelCode: '300L',
        manifesto: 'Industry-linked internships for every 300L student and modernized sports complex facilities.',
        voteCount: 31,
      },
    ],
  });

  await ensureElectionWithCandidates({
    roleId: roleFacPres.id,
    title: 'SEET Faculty President Live Poll',
    description: 'Engineering faculty executive election — live counting.',
    scopeTier: 'FACULTY',
    unitId: facEng.id,
    candidates: [
      {
        fullName: 'Precious Uche',
        photoUrl: 'https://randomuser.me/api/portraits/women/33.jpg',
        departmentName: 'Electrical & Electronic Engineering',
        facultyName: 'School of Engineering (SEET)',
        levelCode: '300L',
        manifesto: 'SEET Robotics Lab funding & cross-department 200L past-question workshops.',
        voteCount: 27,
      },
      {
        fullName: 'Farouk Abdullahi',
        photoUrl: 'https://randomuser.me/api/portraits/men/61.jpg',
        departmentName: 'Mechanical Engineering',
        facultyName: 'School of Engineering (SEET)',
        levelCode: '300L',
        manifesto: 'Workshop toolkits modernization & CAD certification bootcamps.',
        voteCount: 24,
      },
    ],
  });

  // 9b. Peer Selection & Endorsements (Configurable Level-Restricted Flow)
  const samuel = studentsByEmail['student.eee300@futo.studentspark.ng'].user;
  const existingEndorsements = await prisma.sugEndorsementNominee.count({
    where: { schoolId: futo.id },
  });
  if (existingEndorsements === 0) {
    const nomIbrahim = await prisma.sugEndorsementNominee.create({
      data: {
        schoolId: futo.id,
        roleId: roleFacPres.id,
        nomineeUserId: ibrahim.id,
        nominatedById: tobi.id,
        fullName: ibrahim.fullName,
        photoUrl: 'https://randomuser.me/api/portraits/men/75.jpg',
        facultyName: 'School of Engineering (SEET)',
        departmentName: 'Mechanical Engineering',
        levelCode: '200L',
        manifesto: 'Peer-selected to upgrade SEET CAD laboratories and cross-department tutorials.',
        endorsementCount: 2,
        status: 'PENDING_ENDORSEMENT',
      },
    });
    const nomEmeka = await prisma.sugEndorsementNominee.create({
      data: {
        schoolId: futo.id,
        roleId: roleFacPres.id,
        nomineeUserId: emeka.id,
        nominatedById: chidi.id,
        fullName: emeka.fullName,
        photoUrl: 'https://randomuser.me/api/portraits/men/45.jpg',
        facultyName: 'School of Engineering (SEET)',
        departmentName: 'Electrical & Electronic Engineering',
        levelCode: '200L',
        manifesto: 'Transparent faculty exam timetable updates and power-bank study lounges.',
        endorsementCount: 1,
        status: 'PENDING_ENDORSEMENT',
      },
    });
    await prisma.sugEndorsementVote.createMany({
      data: [
        { roleId: roleFacPres.id, nomineeId: nomIbrahim.id, voterId: tobi.id },
        { roleId: roleFacPres.id, nomineeId: nomIbrahim.id, voterId: emeka.id },
        { roleId: roleFacPres.id, nomineeId: nomEmeka.id, voterId: chidi.id },
      ],
      skipDuplicates: true,
    });

    const nomSamuel = await prisma.sugEndorsementNominee.create({
      data: {
        schoolId: futo.id,
        roleId: roleDeptPres.id,
        nomineeUserId: samuel.id,
        nominatedById: zainab.id,
        fullName: samuel.fullName,
        photoUrl: 'https://randomuser.me/api/portraits/men/54.jpg',
        facultyName: 'School of Engineering (SEET)',
        departmentName: 'Electrical & Electronic Engineering',
        levelCode: '300L',
        manifesto: 'Embedded circuits workbench & 300L SIWES industry placement coordination.',
        endorsementCount: 1,
        status: 'PENDING_ENDORSEMENT',
      },
    });
    await prisma.sugEndorsementVote.createMany({
      data: [
        { roleId: roleDeptPres.id, nomineeId: nomSamuel.id, voterId: zainab.id },
      ],
      skipDuplicates: true,
    });
  }

  // 10. SUG Public Posts, Scholarships, Vacancies & 1 Internal Exco Post
  const existingPosts = await prisma.sugPost.count({ where: { schoolId: futo.id } });
  if (existingPosts === 0) {
    await prisma.sugPost.createMany({
      data: [
        {
          schoolId: futo.id,
          authorId: chidi.id,
          category: 'ANNOUNCEMENT',
          title: '2026/2027 SUG Live Elections Are Now Open!',
          body: 'Visit the Live Elections tab to inspect every candidate portrait, department, manifesto and cast your 1-tap ballot. Real-time counting is active.',
          isPinned: true,
          isInternalOnly: false,
          isNationwidePublic: false,
        },
        {
          schoolId: futo.id,
          authorId: chidi.id,
          category: 'SCHOLARSHIP',
          title: 'NNPC / Chevron Nigerian Undergraduate Scholarship 2026',
          body: 'Open to 200L and 300L Engineering & Computer Science students with CGPA 3.50+. Upload transcript & departmental attestation.',
          amountOrStipend: '₦350,000 / Session',
          deadline: '15 Dec 2026',
          isPinned: false,
          isInternalOnly: false,
          isNationwidePublic: true,
        },
        {
          schoolId: futo.id,
          authorId: tobi.id,
          category: 'VACANCY',
          title: 'Campus Embedded Systems & Mobile Internships (5 Slots)',
          body: 'FUTO Innovation Hub & partner Lagos fintech startups are hiring 200L/300L interns for holiday & SIWES placements.',
          amountOrStipend: '₦120,000 / Month',
          deadline: '02 Dec 2026',
          isPinned: false,
          isInternalOnly: false,
          isNationwidePublic: false,
        },
        {
          schoolId: futo.id,
          authorId: adaeze.id,
          category: 'GRANT',
          title: 'National SUG Hardware & Clean-Energy Innovation Grant',
          body: 'Teams of 2-4 Nigerian undergraduates building campus power or study tools can apply for non-dilutive seed grants.',
          amountOrStipend: '₦500,000 Equity-Free Grant',
          deadline: '20 Dec 2026',
          isPinned: false,
          isInternalOnly: false,
          isNationwidePublic: true,
        },
        {
          schoolId: futo.id,
          authorId: chidi.id,
          category: 'INTERNAL_NOTE',
          title: '[Exco Vault] Hostel Water Pump Emergency Repair Memo',
          body: 'Confidential Executive Council minutes: ₹/₦ allocation approval request sent to Dean of Student Affairs. Only Exco & Admin can see this vault note.',
          isPinned: false,
          isInternalOnly: true,
          isNationwidePublic: false,
        },
      ],
    });
  }

  // 11. Welfare Tickets
  const existingWelfare = await prisma.sugWelfareTicket.count({ where: { schoolId: futo.id } });
  if (existingWelfare === 0) {
    await prisma.sugWelfareTicket.createMany({
      data: [
        {
          schoolId: futo.id,
          reporterId: ngozi.id,
          category: 'HOSTEL',
          title: 'Block C Borehole Pump Fault',
          description: 'Water supply in Hostel Block C has been low since Tuesday morning.',
          status: 'IN_REVIEW',
          resolutionNote: 'SUG Welfare Director inspected with Works Dept; replacement valve ordered.',
          isPublicSummary: true,
        },
        {
          schoolId: futo.id,
          reporterId: emeka.id,
          category: 'BURSARY',
          title: 'SUG Emergency Medical Bursary Request',
          description: 'Requesting medical relief stipend verification for 200L EEE student.',
          status: 'OPEN',
          isPublicSummary: false,
        },
        {
          schoolId: futo.id,
          reporterId: kemi.id,
          category: 'TRANSPORT',
          title: 'Evening Exam Shuttle Schedule Extended to 8 PM',
          description: 'Please keep campus shuttles running after CBT evening papers.',
          status: 'RESOLVED',
          resolutionNote: 'Confirmed with SUG Transport Committee: 2 shuttles added until 8:15 PM daily.',
          isPublicSummary: true,
        },
      ],
    });
  }

  // 12. Finance Schedule & Receipts (Read-Only inside SUG Portal)
  let sugFee = await prisma.schoolFeeItem.findFirst({
    where: { schoolId: futo.id, title: 'SUG Union & Welfare Dues (2025/2026)' },
  });
  if (!sugFee) {
    sugFee = await prisma.schoolFeeItem.create({
      data: {
        schoolId: futo.id,
        termId: currentTerm.id,
        title: 'SUG Union & Welfare Dues (2025/2026)',
        description: 'Annual student union dues & ID card maintenance.',
        amountKobo: 250000, // ₦2,500
        isMandatory: true,
      },
    });
  }
  let facultyFee = await prisma.schoolFeeItem.findFirst({
    where: { schoolId: futo.id, title: 'SEET Faculty & Practical Levy' },
  });
  if (!facultyFee) {
    facultyFee = await prisma.schoolFeeItem.create({
      data: {
        schoolId: futo.id,
        termId: currentTerm.id,
        title: 'SEET Faculty & Practical Levy',
        description: 'Workshop safety & engineering practical consumables.',
        amountKobo: 400000, // ₦4,000
        isMandatory: true,
      },
    });
  }

  const payCount = await prisma.schoolFeePayment.count({
    where: { feeItem: { schoolId: futo.id } },
  });
  if (payCount === 0) {
    await prisma.schoolFeePayment.createMany({
      data: [
        {
          feeItemId: sugFee.id,
          studentId: chidi.id,
          amountPaidKobo: 250000,
          paystackReference: 'PSK-FUTO-SUG-1001',
          receiptQrToken: 'QR-FUTO-SUG-1001',
        },
        {
          feeItemId: sugFee.id,
          studentId: ngozi.id,
          amountPaidKobo: 250000,
          paystackReference: 'PSK-FUTO-SUG-1002',
          receiptQrToken: 'QR-FUTO-SUG-1002',
        },
        {
          feeItemId: facultyFee.id,
          studentId: tobi.id,
          amountPaidKobo: 400000,
          paystackReference: 'PSK-FUTO-FAC-1003',
          receiptQrToken: 'QR-FUTO-FAC-1003',
        },
      ],
    });
  }

  // 13. Peer Institution #2: UNILAG (For Nationwide SUG Hub & Cross-Campus Chat)
  let unilag = await prisma.school.findUnique({ where: { schoolCode: 'UNILAG-01' } });
  if (!unilag) {
    unilag = await prisma.school.create({
      data: {
        name: 'University of Lagos (UNILAG)',
        slug: 'unilag',
        schoolCode: 'UNILAG-01',
        institutionType: 'UNIVERSITY',
        masterSecretKey: 'SEC-SPK-UNILAG-4D5E6F7A8B9C',
        contactEmail: 'admin@unilag.studentspark.ng',
      },
    });
  }
  const facSciUnilag =
    (await prisma.academicUnit.findFirst({ where: { schoolId: unilag.id, code: 'FSCI' } })) ||
    (await prisma.academicUnit.create({
      data: { schoolId: unilag.id, name: 'Faculty of Science', code: 'FSCI', unitType: 'FACULTY' },
    }));
  const deptCscUnilag =
    (await prisma.department.findFirst({ where: { schoolId: unilag.id, code: 'CSC' } })) ||
    (await prisma.department.create({
      data: { schoolId: unilag.id, unitId: facSciUnilag.id, name: 'Computer Science', code: 'CSC' },
    }));
  const unilagSugPres = await ensureUser({
    email: 'sug.pres@unilag.studentspark.ng',
    fullName: 'Folake Adeyemi',
    role: 'STUDENT',
    loginId: 'UNILAG/2022/081144',
    schoolId: unilag.id,
    passwordHash,
    avatarUrl: 'https://randomuser.me/api/portraits/women/68.jpg',
  });
  const unilagRolePres =
    (await prisma.sugRoleConfig.findFirst({
      where: { schoolId: unilag.id, title: 'SUG President' },
    })) ||
    (await prisma.sugRoleConfig.create({
      data: {
        schoolId: unilag.id,
        title: 'SUG President',
        tier: 'SUG_CENTRAL',
        description: 'University of Lagos Student Union President',
        dueForElection: false,
        canViewFinanceReadOnly: true,
        canPostPublicUpdates: true,
        canPostOpportunities: true,
        canManageWelfare: true,
        sortOrder: 1,
      },
    }));
  const unilagHolder = await prisma.sugOfficeHolder.findFirst({
    where: { schoolId: unilag.id, roleId: unilagRolePres.id, userId: unilagSugPres.id },
  });
  if (!unilagHolder) {
    await prisma.sugOfficeHolder.create({
      data: {
        schoolId: unilag.id,
        roleId: unilagRolePres.id,
        userId: unilagSugPres.id,
        departmentId: deptCscUnilag.id,
        tenureLabel: '2025/2026',
        photoUrl: 'https://randomuser.me/api/portraits/women/68.jpg',
        manifestoOrBio: 'National Inter-Campus Innovation & Student Welfare Advocacy.',
      },
    });
  }

  const unilagNatPosts = await prisma.sugPost.count({
    where: { schoolId: unilag.id, isNationwidePublic: true },
  });
  if (unilagNatPosts === 0) {
    await prisma.sugPost.create({
      data: {
        schoolId: unilag.id,
        authorId: unilagSugPres.id,
        category: 'SCHOLARSHIP',
        title: 'NANS x Lagos Tech Founders National Bursary (All Universities)',
        body: 'Joint nationwide student grant open to all accredited Nigerian universities & polytechnics. Apply with valid student ID.',
        amountOrStipend: '₦250,000 / Winner',
        deadline: '30 Dec 2026',
        isInternalOnly: false,
        isNationwidePublic: true,
        isPinned: true,
      },
    });
  }

  // Sample 1-on-1 messages
  const msgCount = await prisma.sugLeaderMessage.count();
  if (msgCount === 0) {
    await prisma.sugLeaderMessage.createMany({
      data: [
        {
          schoolId: futo.id,
          senderId: ngozi.id,
          recipientId: chidi.id,
          message: 'Good evening Mr. President, please when will the Block C borehole repair be completed?',
          isNationwide: false,
        },
        {
          schoolId: futo.id,
          senderId: chidi.id,
          recipientId: ngozi.id,
          message: 'Hi Ngozi! Works Dept confirmed the replacement valve arrives tomorrow at 9 AM.',
          isNationwide: false,
        },
        {
          schoolId: unilag.id,
          senderId: unilagSugPres.id,
          recipientId: chidi.id,
          message: 'Solidarity greetings from UNILAG SUG! Please share the NANS Tech Founders Bursary across FUTO.',
          isNationwide: true,
        },
      ],
    });
  }

  console.log('=== Seed Day 15C Complete! ===');
  console.log('FUTO ID:', futo.id, '| Term:', currentTerm.name);
  console.log('UNILAG ID:', unilag.id);
}

main()
  .catch((err) => {
    console.error('Seed Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
