import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const commonPasswordHash = await bcrypt.hash('SparkPass2026!', 10);

  // 1. Ensure University: Federal University of Technology, Owerri (FUTO-01)
  let futo = await prisma.school.findUnique({
    where: { schoolCode: 'FUTO-01' },
  });

  if (!futo) {
    futo = await prisma.school.create({
      data: {
        name: 'Federal University of Technology, Owerri',
        slug: 'futo',
        schoolCode: 'FUTO-01',
        institutionType: 'UNIVERSITY',
        masterSecretKey: 'SEC-SPK-FUTO-9A8B7C6D5E4F3A2B',
        contactEmail: 'admin@futo.studentspark.ng',
        contactPhone: '+2348012345678',
        terminologyConfig: {
          unitLabel: 'School / Faculty',
          departmentLabel: 'Department',
          levelLabel: 'Level',
          courseLabel: 'Course',
          educatorLabel: 'Lecturer',
          studentIdLabel: 'Matriculation No',
          periodLabel: 'Semester',
          degreeOrCertificateLabel: 'Degree',
        },
      },
    });
  } else {
    // Ensure master secret key is populated
    if (!futo.masterSecretKey) {
      futo = await prisma.school.update({
        where: { id: futo.id },
        data: { masterSecretKey: 'SEC-SPK-FUTO-9A8B7C6D5E4F3A2B' },
      });
    }
  }

  // 2. Ensure Secondary School: King's College Lagos (KCL-01)
  let kcl = await prisma.school.findUnique({
    where: { schoolCode: 'KCL-01' },
  });

  if (!kcl) {
    kcl = await prisma.school.create({
      data: {
        name: "King's College Lagos",
        slug: 'kings-college',
        schoolCode: 'KCL-01',
        institutionType: 'SECONDARY',
        masterSecretKey: 'SEC-SPK-KCL-1F2E3D4C5B6A7F8E',
        contactEmail: 'admin@kingscollege.studentspark.ng',
        contactPhone: '+2348087654321',
        terminologyConfig: {
          unitLabel: 'Section',
          departmentLabel: 'Stream / Track',
          levelLabel: 'Class & Arm',
          courseLabel: 'Subject',
          educatorLabel: 'Teacher',
          studentIdLabel: 'Admission No',
          periodLabel: 'Term',
          degreeOrCertificateLabel: 'Report Card',
        },
      },
    });
  } else {
    if (!kcl.masterSecretKey) {
      kcl = await prisma.school.update({
        where: { id: kcl.id },
        data: { masterSecretKey: 'SEC-SPK-KCL-1F2E3D4C5B6A7F8E' },
      });
    }
  }

  // 3. Ensure Faculty/AcademicUnit & Department in FUTO
  let facultyEng = await prisma.academicUnit.findFirst({
    where: { schoolId: futo.id, name: 'School of Engineering and Engineering Technology' },
  });
  if (!facultyEng) {
    facultyEng = await prisma.academicUnit.create({
      data: {
        schoolId: futo.id,
        name: 'School of Engineering and Engineering Technology',
        code: 'SEET',
        unitType: 'FACULTY',
      },
    });
  }

  let deptElectrical = await prisma.department.findFirst({
    where: { schoolId: futo.id, name: 'Electrical & Electronic Engineering' },
  });
  if (!deptElectrical) {
    deptElectrical = await prisma.department.create({
      data: {
        schoolId: futo.id,
        unitId: facultyEng.id,
        name: 'Electrical & Electronic Engineering',
        code: 'EEE',
      },
    });
  }

  // 4. Seed Users across all roles
  const usersToSeed = [
    {
      email: 'superadmin@studentspark.ng',
      fullName: 'Chief SuperAdmin',
      role: 'SUPER_ADMIN' as const,
      loginId: 'SPK-SUPER-01',
      schoolId: null,
      mustChangePassword: false,
    },
    {
      email: 'admin@futo.studentspark.ng',
      fullName: 'Prof. Augustine Nnamdi',
      role: 'SCHOOL_ADMIN' as const,
      loginId: 'FUTO-ADMIN-01',
      schoolId: futo.id,
      mustChangePassword: false,
    },
    {
      email: 'lecturer.ade@futo.studentspark.ng',
      fullName: 'Dr. Adeyemi Balogun',
      role: 'TEACHER' as const,
      loginId: 'STAFF/EEE/2020/042',
      schoolId: futo.id,
      mustChangePassword: false,
      isStaff: true,
      staffId: 'STAFF/EEE/2020/042',
    },
    {
      email: 'bursar@futo.studentspark.ng',
      fullName: 'Mrs. Chinyere Okeke',
      role: 'SCHOOL_FINANCE' as const,
      loginId: 'BURSAR-FUTO-01',
      schoolId: futo.id,
      mustChangePassword: false,
    },
    {
      email: 'student.chidi@futo.studentspark.ng',
      fullName: 'Chidi Chukwuma',
      role: 'STUDENT' as const,
      loginId: 'FUTO/2023/104928',
      schoolId: futo.id,
      mustChangePassword: false,
      isStudent: true,
      matricNo: 'FUTO/2023/104928',
    },
    {
      email: 'admin@kingscollege.studentspark.ng',
      fullName: 'Principal O. Adeleke',
      role: 'SCHOOL_ADMIN' as const,
      loginId: 'KCL-ADMIN-01',
      schoolId: kcl.id,
      mustChangePassword: false,
    },
    {
      email: 'teacher.folake@kingscollege.studentspark.ng',
      fullName: 'Mrs. Folake Daniel',
      role: 'TEACHER' as const,
      loginId: 'KCL-STAFF-105',
      schoolId: kcl.id,
      mustChangePassword: false,
      isStaff: true,
      staffId: 'KCL-STAFF-105',
    },
    {
      email: 'independent.learner@gmail.com',
      fullName: 'Amara Nwosu',
      role: 'STUDENT' as const,
      loginId: null,
      schoolId: null,
      mustChangePassword: false,
    },
    {
      email: 'independent.educator@gmail.com',
      fullName: 'Mazi Emeka Tutor',
      role: 'TEACHER' as const,
      loginId: null,
      schoolId: null,
      mustChangePassword: false,
    },
  ];

  console.log('Seeding / updating accounts...');

  for (const u of usersToSeed) {
    let user = await prisma.user.findUnique({
      where: { email: u.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: u.email,
          fullName: u.fullName,
          passwordHash: commonPasswordHash,
          role: u.role,
          loginId: u.loginId,
          schoolId: u.schoolId,
          mustChangePassword: u.mustChangePassword,
          referralCode: `REF-${Math.floor(100000 + Math.random() * 900000)}`,
        },
      });
      console.log(`Created user: ${u.email} (${u.role})`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: commonPasswordHash,
          role: u.role,
          loginId: u.loginId,
          schoolId: u.schoolId,
          mustChangePassword: u.mustChangePassword,
        },
      });
      console.log(`Updated user: ${u.email} (${u.role})`);
    }

    // Ensure Membership record if institutional
    if (u.schoolId) {
      let membership = await prisma.membership.findFirst({
        where: { userId: user.id, schoolId: u.schoolId },
      });
      if (!membership) {
        membership = await prisma.membership.create({
          data: {
            userId: user.id,
            schoolId: u.schoolId,
            role: u.role,
            loginId: u.loginId,
            status: 'ACTIVE',
          },
        });
      } else {
        await prisma.membership.update({
          where: { id: membership.id },
          data: {
            role: u.role,
            loginId: u.loginId,
            status: 'ACTIVE',
          },
        });
      }
    }

    // Teacher profile if staff
    if (u.isStaff && u.schoolId) {
      let tProf = await prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      if (!tProf) {
        await prisma.teacherProfile.create({
          data: {
            userId: user.id,
            schoolId: u.schoolId,
            staffId: u.staffId || u.loginId || 'STAFF-001',
            departmentId: deptElectrical?.id,
            title: 'Senior Lecturer',
          },
        });
      }
    }

    // Student profile if enrolled student
    if (u.isStudent && u.schoolId) {
      let sProf = await prisma.studentProfile.findUnique({
        where: { userId: user.id },
      });
      if (!sProf) {
        await prisma.studentProfile.create({
          data: {
            userId: user.id,
            schoolId: u.schoolId,
            matricOrAdmissionNo: u.matricNo || u.loginId || 'MATRIC-001',
            departmentId: deptElectrical?.id,
            level: '300 Level',
          },
        });
      }
    }
  }

  console.log('✅ ALL TEST USERS SEEDED SUCCESSFULLY!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
