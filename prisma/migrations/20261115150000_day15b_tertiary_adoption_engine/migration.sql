-- Day 15B: Nigerian Tertiary Institutions Adoption Engine
-- Adds Course Rep delegation, broadcasts & instant lecture attendance slips,
-- 10-year departmental past question bank, lecturer handout royalty split fields,
-- SUG / departmental fast onboarding campaigns, and strike-proof continuity mode.

ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "academicContinuityMode" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "strikeNoticeTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "strikeNoticeBody" TEXT,
  ADD COLUMN IF NOT EXISTS "strikePausedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "continuityUpdatedAt" TIMESTAMP(3);

ALTER TABLE "student_profiles"
  ADD COLUMN IF NOT EXISTS "isCourseRep" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "marketplace_items"
  ADD COLUMN IF NOT EXISTS "materialType" TEXT NOT NULL DEFAULT 'BOOK',
  ADD COLUMN IF NOT EXISTS "royaltySplitJson" JSONB,
  ADD COLUMN IF NOT EXISTS "paystackSubaccountCode" TEXT;

CREATE TABLE IF NOT EXISTS "course_rep_assignments" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "subjectId" TEXT,
  "departmentId" TEXT,
  "studentId" TEXT NOT NULL,
  "delegatedById" TEXT,
  "title" TEXT NOT NULL DEFAULT 'Course Representative',
  "canBroadcastVenue" BOOLEAN NOT NULL DEFAULT true,
  "canDistributeSlides" BOOLEAN NOT NULL DEFAULT true,
  "canGenerateAttendanceSlips" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "course_rep_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "course_rep_assignments_schoolId_classId_subjectId_studentId_key"
  ON "course_rep_assignments"("schoolId", "classId", "subjectId", "studentId");
CREATE INDEX IF NOT EXISTS "course_rep_assignments_studentId_isActive_idx"
  ON "course_rep_assignments"("studentId", "isActive");
CREATE INDEX IF NOT EXISTS "course_rep_assignments_schoolId_classId_idx"
  ON "course_rep_assignments"("schoolId", "classId");

ALTER TABLE "course_rep_assignments"
  ADD CONSTRAINT "course_rep_assignments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_assignments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_assignments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_assignments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_assignments_delegatedById_fkey" FOREIGN KEY ("delegatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "course_rep_broadcasts" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "subjectId" TEXT,
  "senderId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "venue" TEXT,
  "scheduledTime" TEXT,
  "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "course_rep_broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "course_rep_broadcasts_schoolId_classId_createdAt_idx"
  ON "course_rep_broadcasts"("schoolId", "classId", "createdAt");

ALTER TABLE "course_rep_broadcasts"
  ADD CONSTRAINT "course_rep_broadcasts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_broadcasts_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_broadcasts_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_broadcasts_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "course_rep_attendance_slips" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "subjectId" TEXT,
  "createdById" TEXT NOT NULL,
  "courseCode" TEXT NOT NULL,
  "courseTitle" TEXT NOT NULL,
  "venue" TEXT,
  "slipCode" TEXT NOT NULL,
  "linkedSessionId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "course_rep_attendance_slips_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "course_rep_attendance_slips_slipCode_key"
  ON "course_rep_attendance_slips"("slipCode");
CREATE INDEX IF NOT EXISTS "course_rep_attendance_slips_schoolId_classId_createdAt_idx"
  ON "course_rep_attendance_slips"("schoolId", "classId", "createdAt");

ALTER TABLE "course_rep_attendance_slips"
  ADD CONSTRAINT "course_rep_attendance_slips_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_attendance_slips_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_attendance_slips_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_attendance_slips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "course_rep_attendance_slip_entries" (
  "id" TEXT NOT NULL,
  "slipId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "matricNo" TEXT,
  "studentName" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "course_rep_attendance_slip_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "course_rep_attendance_slip_entries_slipId_studentId_key"
  ON "course_rep_attendance_slip_entries"("slipId", "studentId");
CREATE INDEX IF NOT EXISTS "course_rep_attendance_slip_entries_slipId_idx"
  ON "course_rep_attendance_slip_entries"("slipId");

ALTER TABLE "course_rep_attendance_slip_entries"
  ADD CONSTRAINT "course_rep_attendance_slip_entries_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "course_rep_attendance_slips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "course_rep_attendance_slip_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "departmental_past_questions" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT,
  "departmentId" TEXT,
  "institutionType" "InstitutionType" NOT NULL DEFAULT 'UNIVERSITY',
  "facultyName" TEXT,
  "departmentName" TEXT NOT NULL,
  "levelCode" TEXT NOT NULL DEFAULT '100L',
  "courseCode" TEXT NOT NULL,
  "courseTitle" TEXT NOT NULL,
  "academicYear" TEXT NOT NULL,
  "semester" TEXT NOT NULL DEFAULT 'First Semester',
  "examType" TEXT NOT NULL DEFAULT 'Semester Exam',
  "questionText" TEXT NOT NULL,
  "fileUrl" TEXT,
  "aiSolutionJson" JSONB,
  "isVerifiedByLecturer" BOOLEAN NOT NULL DEFAULT false,
  "verifiedById" TEXT,
  "uploadedById" TEXT,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "departmental_past_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "departmental_past_questions_schoolId_departmentName_courseCode_academicYear_idx"
  ON "departmental_past_questions"("schoolId", "departmentName", "courseCode", "academicYear");
CREATE INDEX IF NOT EXISTS "departmental_past_questions_institutionType_courseCode_idx"
  ON "departmental_past_questions"("institutionType", "courseCode");

ALTER TABLE "departmental_past_questions"
  ADD CONSTRAINT "departmental_past_questions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "departmental_past_questions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "departmental_past_questions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_onboarding_campaigns" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "departmentId" TEXT,
  "classId" TEXT,
  "associationName" TEXT NOT NULL,
  "shortCode" TEXT NOT NULL,
  "defaultLevel" TEXT NOT NULL DEFAULT '100L',
  "welcomeMessage" TEXT,
  "createdById" TEXT,
  "joinedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_onboarding_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sug_onboarding_campaigns_shortCode_key"
  ON "sug_onboarding_campaigns"("shortCode");
CREATE INDEX IF NOT EXISTS "sug_onboarding_campaigns_schoolId_isActive_idx"
  ON "sug_onboarding_campaigns"("schoolId", "isActive");

ALTER TABLE "sug_onboarding_campaigns"
  ADD CONSTRAINT "sug_onboarding_campaigns_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_onboarding_campaigns_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_onboarding_campaigns_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
