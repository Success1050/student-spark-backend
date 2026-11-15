-- CreateEnum
CREATE TYPE "CalendarBreakType" AS ENUM ('HOLIDAY', 'MID_TERM', 'OTHER');

-- AlterTable
ALTER TABLE "academic_terms" ADD COLUMN     "nextTermResumesDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "school_calendar_events" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CalendarBreakType" NOT NULL DEFAULT 'HOLIDAY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "school_calendar_events_schoolId_termId_idx" ON "school_calendar_events"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "student_profiles_matricOrAdmissionNo_idx" ON "student_profiles"("matricOrAdmissionNo");

-- CreateIndex
CREATE INDEX "teacher_profiles_staffId_idx" ON "teacher_profiles"("staffId");

-- AddForeignKey
ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
