-- AlterTable
ALTER TABLE "teacher_profiles" ADD COLUMN     "address" TEXT,
ADD COLUMN     "dateHired" TIMESTAMP(3),
ADD COLUMN     "educationLevel" TEXT,
ADD COLUMN     "employmentType" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "qualificationDetails" TEXT,
ADD COLUMN     "yearsOfExperience" INTEGER;
