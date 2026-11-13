-- CreateEnum: MarketplaceVisibilityScope
DO $$ BEGIN
    CREATE TYPE "MarketplaceVisibilityScope" AS ENUM ('COURSE_OR_CLASS', 'DEPARTMENT_OR_FACULTY', 'SCHOOL_WIDE', 'PUBLIC_MARKETPLACE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: marketplace_items (add visibilityScope and institutional hierarchy fields)
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "visibilityScope" "MarketplaceVisibilityScope" NOT NULL DEFAULT 'PUBLIC_MARKETPLACE';
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "facultyName" TEXT;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "departmentName" TEXT;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "levelName" TEXT;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "termOrSemester" TEXT;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "classId" TEXT;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "subjectId" TEXT;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER;
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "format" TEXT DEFAULT 'PDF';
ALTER TABLE "marketplace_items" ADD COLUMN IF NOT EXISTS "downloadCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_items_visibilityScope_idx" ON "marketplace_items"("visibilityScope");
CREATE INDEX IF NOT EXISTS "marketplace_items_classId_idx" ON "marketplace_items"("classId");
CREATE INDEX IF NOT EXISTS "marketplace_items_subjectId_idx" ON "marketplace_items"("subjectId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "marketplace_items" ADD CONSTRAINT "marketplace_items_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_items" ADD CONSTRAINT "marketplace_items_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
