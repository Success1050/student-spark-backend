-- AlterTable
ALTER TABLE "attendance_sessions" ALTER COLUMN "subjectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "school_classes" ADD COLUMN     "minAttendancePercent" INTEGER NOT NULL DEFAULT 75;

-- AlterTable
ALTER TABLE "teacher_profiles" ADD COLUMN     "handlesAllSubjects" BOOLEAN NOT NULL DEFAULT false;
