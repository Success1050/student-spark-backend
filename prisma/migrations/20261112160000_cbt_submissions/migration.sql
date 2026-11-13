-- CreateTable
CREATE TABLE "cbt_submissions" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMarks" INTEGER NOT NULL DEFAULT 0,
    "totalPossibleMarks" INTEGER NOT NULL DEFAULT 100,
    "answersJson" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cbt_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cbt_submissions_quizId_studentId_key" ON "cbt_submissions"("quizId", "studentId");

-- CreateIndex
CREATE INDEX "cbt_submissions_quizId_idx" ON "cbt_submissions"("quizId");

-- CreateIndex
CREATE INDEX "cbt_submissions_studentId_idx" ON "cbt_submissions"("studentId");

-- AddForeignKey
ALTER TABLE "cbt_submissions" ADD CONSTRAINT "cbt_submissions_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt_submissions" ADD CONSTRAINT "cbt_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
