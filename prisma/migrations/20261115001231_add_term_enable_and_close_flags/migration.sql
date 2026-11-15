-- AlterTable
ALTER TABLE "academic_terms" ADD COLUMN     "isClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: Keep active terms and any terms with existing grades/report cards enabled
UPDATE "academic_terms"
SET "isEnabled" = true
WHERE "isCurrent" = true
   OR EXISTS (SELECT 1 FROM "student_subject_grades" g WHERE g."termId" = "academic_terms"."id")
   OR EXISTS (SELECT 1 FROM "terminal_report_cards" r WHERE r."termId" = "academic_terms"."id");
