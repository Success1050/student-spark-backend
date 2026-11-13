-- AlterTable: users (add longestStreak)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "longestStreak" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: notes (convert listsOfTopic from TEXT[] to JSONB for [{ topic, explanation }])
ALTER TABLE "notes" DROP COLUMN IF EXISTS "listsOfTopic";
ALTER TABLE "notes" ADD COLUMN "listsOfTopic" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: quizzes (add mobile compatibility fields)
ALTER TABLE "quizzes" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT '#6366F1';
ALTER TABLE "quizzes" ADD COLUMN IF NOT EXISTS "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "quizzes" ADD COLUMN IF NOT EXISTS "totalMarks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "quizzes" ADD COLUMN IF NOT EXISTS "totalPossibleMarks" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "quizzes" ADD COLUMN IF NOT EXISTS "correctCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: practice_question_sets (add mobile compatibility fields)
ALTER TABLE "practice_question_sets" ADD COLUMN IF NOT EXISTS "noteIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "practice_question_sets" ADD COLUMN IF NOT EXISTS "totalQuestions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "practice_question_sets" ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "practice_question_sets" ADD COLUMN IF NOT EXISTS "score" DOUBLE PRECISION;
ALTER TABLE "practice_question_sets" ADD COLUMN IF NOT EXISTS "totalAttempted" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: student_studyplans (add mobile compatibility fields)
ALTER TABLE "student_studyplans" ADD COLUMN IF NOT EXISTS "planName" TEXT NOT NULL DEFAULT 'Study Plan';
ALTER TABLE "student_studyplans" ADD COLUMN IF NOT EXISTS "examDate" TEXT;
ALTER TABLE "student_studyplans" ADD COLUMN IF NOT EXISTS "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "student_studyplans" ADD COLUMN IF NOT EXISTS "studyHoursRange" TEXT NOT NULL DEFAULT '4-5';
ALTER TABLE "student_studyplans" ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: user_courses (replaces Supabase 'subjects' table for personal study courses)
CREATE TABLE IF NOT EXISTS "user_courses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_courses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_courses_userId_idx" ON "user_courses"("userId");

ALTER TABLE "user_courses" ADD CONSTRAINT "user_courses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
