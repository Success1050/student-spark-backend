-- AlterEnum: UserRole add SCHOOL_FINANCE
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SCHOOL_FINANCE';

-- CreateEnum: MembershipStatus
DO $$ BEGIN
    CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_FIRST_LOGIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: schools (add dynamic terminologyConfig)
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "terminologyConfig" JSONB;

-- AlterTable: users (add loginId and mustChangePassword)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "loginId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: academic_units
CREATE TABLE IF NOT EXISTS "academic_units" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT 'FACULTY',
    "deanOrHeadId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "academic_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable: departments
CREATE TABLE IF NOT EXISTS "departments" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "unitId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- AlterTable: school_classes
ALTER TABLE "school_classes" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
ALTER TABLE "school_classes" ADD COLUMN IF NOT EXISTS "termOrSemester" TEXT;

-- AlterTable: school_subjects
ALTER TABLE "school_subjects" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;

-- CreateTable: memberships
CREATE TABLE IF NOT EXISTS "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "loginId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable: teacher_profiles
CREATE TABLE IF NOT EXISTS "teacher_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "staffId" TEXT,
    "departmentId" TEXT,
    "title" TEXT DEFAULT 'Teacher',
    "specialization" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: student_profiles
CREATE TABLE IF NOT EXISTS "student_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "matricOrAdmissionNo" TEXT,
    "departmentId" TEXT,
    "classId" TEXT,
    "level" TEXT DEFAULT '100L',
    "cgpa" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "userId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: _SchoolClassToTeacherProfile (m-to-m)
CREATE TABLE IF NOT EXISTS "_SchoolClassToTeacherProfile" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable: _SchoolSubjectToTeacherProfile (m-to-m)
CREATE TABLE IF NOT EXISTS "_SchoolSubjectToTeacherProfile" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "academic_units_schoolId_code_key" ON "academic_units"("schoolId", "code");
CREATE INDEX IF NOT EXISTS "academic_units_schoolId_idx" ON "academic_units"("schoolId");

CREATE UNIQUE INDEX IF NOT EXISTS "departments_schoolId_code_key" ON "departments"("schoolId", "code");
CREATE INDEX IF NOT EXISTS "departments_schoolId_unitId_idx" ON "departments"("schoolId", "unitId");

CREATE INDEX IF NOT EXISTS "school_classes_departmentId_idx" ON "school_classes"("departmentId");
CREATE INDEX IF NOT EXISTS "school_subjects_departmentId_idx" ON "school_subjects"("departmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "memberships_schoolId_loginId_key" ON "memberships"("schoolId", "loginId");
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_schoolId_userId_key" ON "memberships"("schoolId", "userId");
CREATE INDEX IF NOT EXISTS "memberships_userId_idx" ON "memberships"("userId");
CREATE INDEX IF NOT EXISTS "memberships_schoolId_role_idx" ON "memberships"("schoolId", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "teacher_profiles_userId_key" ON "teacher_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "teacher_profiles_schoolId_staffId_key" ON "teacher_profiles"("schoolId", "staffId");
CREATE INDEX IF NOT EXISTS "teacher_profiles_schoolId_idx" ON "teacher_profiles"("schoolId");

CREATE UNIQUE INDEX IF NOT EXISTS "student_profiles_userId_key" ON "student_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "student_profiles_schoolId_matricOrAdmissionNo_key" ON "student_profiles"("schoolId", "matricOrAdmissionNo");
CREATE INDEX IF NOT EXISTS "student_profiles_schoolId_departmentId_idx" ON "student_profiles"("schoolId", "departmentId");
CREATE INDEX IF NOT EXISTS "student_profiles_schoolId_classId_idx" ON "student_profiles"("schoolId", "classId");

CREATE INDEX IF NOT EXISTS "audit_logs_schoolId_action_createdAt_idx" ON "audit_logs"("schoolId", "action", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");

CREATE INDEX IF NOT EXISTS "users_loginId_idx" ON "users"("loginId");

CREATE UNIQUE INDEX IF NOT EXISTS "_SchoolClassToTeacherProfile_AB_unique" ON "_SchoolClassToTeacherProfile"("A", "B");
CREATE INDEX IF NOT EXISTS "_SchoolClassToTeacherProfile_B_index" ON "_SchoolClassToTeacherProfile"("B");

CREATE UNIQUE INDEX IF NOT EXISTS "_SchoolSubjectToTeacherProfile_AB_unique" ON "_SchoolSubjectToTeacherProfile"("A", "B");
CREATE INDEX IF NOT EXISTS "_SchoolSubjectToTeacherProfile_B_index" ON "_SchoolSubjectToTeacherProfile"("B");

-- Foreign Keys
DO $$ BEGIN
    ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "departments" ADD CONSTRAINT "departments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "departments" ADD CONSTRAINT "departments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "memberships" ADD CONSTRAINT "memberships_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "_SchoolClassToTeacherProfile" ADD CONSTRAINT "_SchoolClassToTeacherProfile_A_fkey" FOREIGN KEY ("A") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "_SchoolClassToTeacherProfile" ADD CONSTRAINT "_SchoolClassToTeacherProfile_B_fkey" FOREIGN KEY ("B") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "_SchoolSubjectToTeacherProfile" ADD CONSTRAINT "_SchoolSubjectToTeacherProfile_A_fkey" FOREIGN KEY ("A") REFERENCES "school_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "_SchoolSubjectToTeacherProfile" ADD CONSTRAINT "_SchoolSubjectToTeacherProfile_B_fkey" FOREIGN KEY ("B") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
