-- Day 16B: Smart 1-Click Class Promotion & Session Rollover Engine

-- 1. Add academicStatus & graduatedAt to student_profiles
ALTER TABLE "student_profiles"
ADD COLUMN IF NOT EXISTS "academicStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "graduatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "student_profiles_schoolId_academicStatus_idx"
ON "student_profiles"("schoolId", "academicStatus");

-- 2. Create promotion_batches table
CREATE TABLE IF NOT EXISTS "promotion_batches" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fromSessionId" TEXT,
    "fromSessionName" TEXT NOT NULL,
    "toSessionName" TEXT,
    "scopeType" TEXT NOT NULL DEFAULT 'SINGLE_CLASS',
    "status" TEXT NOT NULL DEFAULT 'EXECUTED',
    "passMarkPercent" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "trialMarkPercent" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "promotedCount" INTEGER NOT NULL DEFAULT 0,
    "repeatedCount" INTEGER NOT NULL DEFAULT 0,
    "graduatedCount" INTEGER NOT NULL DEFAULT 0,
    "autoCreatedClassesCount" INTEGER NOT NULL DEFAULT 0,
    "generatedInvoicesCount" INTEGER NOT NULL DEFAULT 0,
    "executedById" TEXT,
    "rolledBackById" TEXT,
    "rolledBackAt" TIMESTAMP(3),
    "canUndoUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "promotion_batches_schoolId_createdAt_idx"
ON "promotion_batches"("schoolId", "createdAt");

CREATE INDEX IF NOT EXISTS "promotion_batches_schoolId_status_idx"
ON "promotion_batches"("schoolId", "status");

-- 3. Create promotion_batch_entries table
CREATE TABLE IF NOT EXISTS "promotion_batch_entries" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromClassId" TEXT,
    "fromClassName" TEXT,
    "fromLevel" TEXT,
    "fromAcademicStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "toClassId" TEXT,
    "toClassName" TEXT,
    "toLevel" TEXT,
    "toAcademicStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "decision" TEXT NOT NULL,
    "annualAverage" DOUBLE PRECISION,
    "unpaidArrearsKobo" INTEGER NOT NULL DEFAULT 0,
    "createdInvoiceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_batch_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "promotion_batch_entries_batchId_idx"
ON "promotion_batch_entries"("batchId");

CREATE INDEX IF NOT EXISTS "promotion_batch_entries_studentId_idx"
ON "promotion_batch_entries"("studentId");

-- 4. Create promotion_class_reviews table (Zero-stress Form Teacher confirmation & exceptions)
CREATE TABLE IF NOT EXISTS "promotion_class_reviews" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT,
    "classId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "exceptionsJson" JSONB,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_class_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "promotion_class_reviews_schoolId_classId_key"
ON "promotion_class_reviews"("schoolId", "classId");

CREATE INDEX IF NOT EXISTS "promotion_class_reviews_schoolId_sessionId_idx"
ON "promotion_class_reviews"("schoolId", "sessionId");

-- Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_batches_schoolId_fkey') THEN
        ALTER TABLE "promotion_batches"
            ADD CONSTRAINT "promotion_batches_schoolId_fkey"
            FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_batches_fromSessionId_fkey') THEN
        ALTER TABLE "promotion_batches"
            ADD CONSTRAINT "promotion_batches_fromSessionId_fkey"
            FOREIGN KEY ("fromSessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_batches_executedById_fkey') THEN
        ALTER TABLE "promotion_batches"
            ADD CONSTRAINT "promotion_batches_executedById_fkey"
            FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_batches_rolledBackById_fkey') THEN
        ALTER TABLE "promotion_batches"
            ADD CONSTRAINT "promotion_batches_rolledBackById_fkey"
            FOREIGN KEY ("rolledBackById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_batch_entries_batchId_fkey') THEN
        ALTER TABLE "promotion_batch_entries"
            ADD CONSTRAINT "promotion_batch_entries_batchId_fkey"
            FOREIGN KEY ("batchId") REFERENCES "promotion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_batch_entries_studentId_fkey') THEN
        ALTER TABLE "promotion_batch_entries"
            ADD CONSTRAINT "promotion_batch_entries_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_class_reviews_schoolId_fkey') THEN
        ALTER TABLE "promotion_class_reviews"
            ADD CONSTRAINT "promotion_class_reviews_schoolId_fkey"
            FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_class_reviews_sessionId_fkey') THEN
        ALTER TABLE "promotion_class_reviews"
            ADD CONSTRAINT "promotion_class_reviews_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_class_reviews_classId_fkey') THEN
        ALTER TABLE "promotion_class_reviews"
            ADD CONSTRAINT "promotion_class_reviews_classId_fkey"
            FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_class_reviews_reviewedById_fkey') THEN
        ALTER TABLE "promotion_class_reviews"
            ADD CONSTRAINT "promotion_class_reviews_reviewedById_fkey"
            FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
