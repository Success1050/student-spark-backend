-- AlterTable
ALTER TABLE "_SchoolClassToTeacherProfile" ADD CONSTRAINT "_SchoolClassToTeacherProfile_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_SchoolClassToTeacherProfile_AB_unique";

-- AlterTable
ALTER TABLE "_SchoolSubjectToTeacherProfile" ADD CONSTRAINT "_SchoolSubjectToTeacherProfile_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_SchoolSubjectToTeacherProfile_AB_unique";

-- AlterTable
ALTER TABLE "academic_units" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "departments" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "memberships" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quizzes" ALTER COLUMN "timeLimit" SET DEFAULT 600;

-- AlterTable
ALTER TABLE "school_subjects" ALTER COLUMN "creditUnits" DROP NOT NULL,
ALTER COLUMN "creditUnits" DROP DEFAULT;

-- AlterTable
ALTER TABLE "student_profiles" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "teacher_profiles" ALTER COLUMN "updatedAt" DROP DEFAULT;
