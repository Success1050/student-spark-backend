-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "guardianEmail" TEXT,
ADD COLUMN     "guardianName" TEXT,
ADD COLUMN     "guardianPhone" TEXT,
ADD COLUMN     "guardianRelationship" TEXT;

-- CreateTable
CREATE TABLE "class_teacher_assignment_history" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "roleLabel" TEXT,
    "subjectSummary" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "class_teacher_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_teacher_assignment_history_schoolId_classId_idx" ON "class_teacher_assignment_history"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "class_teacher_assignment_history_teacherProfileId_idx" ON "class_teacher_assignment_history"("teacherProfileId");

-- AddForeignKey
ALTER TABLE "class_teacher_assignment_history" ADD CONSTRAINT "class_teacher_assignment_history_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teacher_assignment_history" ADD CONSTRAINT "class_teacher_assignment_history_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
