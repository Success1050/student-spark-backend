-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionPlanType" AS ENUM ('free', 'premium', 'pro');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('SECONDARY', 'POLYTECHNIC', 'UNIVERSITY', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolModule" AS ENUM ('CLASS_NOTES', 'ATTENDANCE', 'CBT_ASSESSMENTS', 'AUTO_GRADING_REPORT_CARDS', 'FEE_COLLECTION', 'STUDY_COMMUNITIES', 'ELIBRARY_MARKETPLACE', 'AI_STUDY_TOOLS', 'GAMES_ARCADE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WalletTxCategory" AS ENUM ('REFERRAL_COMMISSION', 'SCHOOL_REFERRAL_BOUNTY', 'MARKETPLACE_SALE', 'WITHDRAWAL', 'REFUND');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "MarketplaceItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('QUIZ_BATTLE_1V1', 'CONCEPT_SCRAMBLE', 'SPEED_MATH', 'MEMORY_MATCH', 'SCHOLAR_LADDER');

-- CreateEnum
CREATE TYPE "GameMatchStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "platform_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'GLOBAL',
    "marketplacePlatformPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "studentReferralCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "schoolReferralBountyPercent" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "schoolFeeTransactionFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "minimumWithdrawalKobo" INTEGER NOT NULL DEFAULT 100000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "interval" TEXT NOT NULL DEFAULT 'monthly',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_subscription_tiers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPriceNaira" INTEGER NOT NULL DEFAULT 0,
    "yearlyPriceNaira" INTEGER NOT NULL DEFAULT 0,
    "maxStudentSeats" INTEGER NOT NULL DEFAULT 200,
    "enabledModules" "SchoolModule"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_subscription_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "schoolCode" TEXT NOT NULL,
    "institutionType" "InstitutionType" NOT NULL DEFAULT 'SECONDARY',
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#EA580C',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1E293B',
    "address" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "tierId" TEXT,
    "enabledModules" "SchoolModule"[],
    "maxSeats" INTEGER NOT NULL DEFAULT 200,
    "subscriptionStart" TIMESTAMP(3),
    "subscriptionEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customMarketplaceCommissionPercent" DOUBLE PRECISION,
    "defaultMinAttendancePercent" DOUBLE PRECISION NOT NULL DEFAULT 75.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_sessions" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_terms" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_classes" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "levelCode" TEXT,
    "inviteCode" TEXT NOT NULL,
    "formTeacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_subjects" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT,
    "name" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "creditUnits" INTEGER NOT NULL DEFAULT 3,
    "minAttendancePercent" DOUBLE PRECISION NOT NULL DEFAULT 75.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "fullName" TEXT,
    "username" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "schoolId" TEXT,
    "classId" TEXT,
    "studentCode" TEXT,
    "plan" "SubscriptionPlanType" NOT NULL DEFAULT 'free',
    "billingCycle" "BillingCycle",
    "subscriptionStart" TIMESTAMP(3),
    "subscriptionEnd" TIMESTAMP(3),
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedDate" TEXT,
    "courses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "motivation" TEXT,
    "xpPoints" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_tracking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionDate" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT,
    "classId" TEXT,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL DEFAULT 'General',
    "color" TEXT NOT NULL DEFAULT '#EA580C',
    "listsOfTopic" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileUrl" TEXT,
    "isClassNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT,
    "schoolId" TEXT,
    "classId" TEXT,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL DEFAULT 'General',
    "questions" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "timeLimit" INTEGER NOT NULL DEFAULT 10,
    "isClassCbt" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "past_questions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT 'Unknown Subject',
    "year" TEXT NOT NULL DEFAULT 'Unknown Year',
    "fileUrl" TEXT,
    "analyzed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "past_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "past_question_topics" (
    "id" TEXT NOT NULL,
    "pastQuestionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "past_question_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_question_sets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT,
    "title" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL DEFAULT 'General',
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_studyplans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "hoursPerDay" DOUBLE PRECISION NOT NULL,
    "planJson" JSONB NOT NULL,
    "studyProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_studyplans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studyPlanId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "dayNumber" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "courseCode" TEXT NOT NULL DEFAULT 'General',
    "color" TEXT NOT NULL DEFAULT '#EA580C',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "isManualSession" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinCode" TEXT,
    "pinExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_configs" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subjectId" TEXT,
    "componentsJson" JSONB NOT NULL,
    "gradeScaleJson" JSONB NOT NULL,
    "gpaScaleMax" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_subject_grades" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scoresJson" JSONB NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "letterGrade" TEXT NOT NULL DEFAULT 'F',
    "gradePoint" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subjectPosition" INTEGER,
    "subjectOrdinal" TEXT,
    "teacherComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_subject_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_report_cards" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gpa" DOUBLE PRECISION,
    "cgpa" DOUBLE PRECISION,
    "overallPosition" INTEGER,
    "overallOrdinal" TEXT,
    "attendancePercent" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "examEligible" BOOLEAN NOT NULL DEFAULT true,
    "teacherRemark" TEXT,
    "principalRemark" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_fee_items" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountKobo" INTEGER NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_fee_payments" (
    "id" TEXT NOT NULL,
    "feeItemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountPaidKobo" INTEGER NOT NULL,
    "platformFeeKobo" INTEGER NOT NULL DEFAULT 0,
    "paystackReference" TEXT NOT NULL,
    "receiptQrToken" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableBalanceKobo" INTEGER NOT NULL DEFAULT 0,
    "pendingBalanceKobo" INTEGER NOT NULL DEFAULT 0,
    "totalWithdrawnKobo" INTEGER NOT NULL DEFAULT 0,
    "bankName" TEXT,
    "bankCode" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "category" "WalletTxCategory" NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "commissionEarnedKobo" INTEGER NOT NULL DEFAULT 0,
    "hasRewarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "bankDetailsJson" JSONB NOT NULL,
    "rejectionReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_items" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "schoolId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "authorName" TEXT,
    "courseCode" TEXT NOT NULL DEFAULT 'General',
    "institutionType" "InstitutionType" NOT NULL DEFAULT 'UNIVERSITY',
    "priceKobo" INTEGER NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "coverUrl" TEXT,
    "encryptedFileUrl" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "status" "MarketplaceItemStatus" NOT NULL DEFAULT 'PENDING',
    "customPlatformCommissionPercent" DOUBLE PRECISION,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_purchases" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "amountPaidKobo" INTEGER NOT NULL,
    "platformCommissionKobo" INTEGER NOT NULL,
    "sellerEarningsKobo" INTEGER NOT NULL,
    "paystackReference" TEXT NOT NULL,
    "watermarkText" TEXT NOT NULL,
    "offlineLicenseToken" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_communities" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "inviteCode" TEXT NOT NULL,
    "isOfficialSchoolHub" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_channels" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_members" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentType" TEXT,
    "attachmentId" TEXT,
    "attachmentMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_matches" (
    "id" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "status" "GameMatchStatus" NOT NULL DEFAULT 'WAITING',
    "hostUserId" TEXT NOT NULL,
    "opponentUserId" TEXT,
    "schoolId" TEXT,
    "noteId" TEXT,
    "inviteCode" TEXT,
    "questionsJson" JSONB NOT NULL,
    "hostScore" INTEGER NOT NULL DEFAULT 0,
    "opponentScore" INTEGER NOT NULL DEFAULT 0,
    "winnerId" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "game_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "deepLink" TEXT,
    "dataJson" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_configs_key_key" ON "platform_configs"("key");
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");
CREATE UNIQUE INDEX "school_subscription_tiers_code_key" ON "school_subscription_tiers"("code");
CREATE UNIQUE INDEX "schools_slug_key" ON "schools"("slug");
CREATE UNIQUE INDEX "schools_schoolCode_key" ON "schools"("schoolCode");
CREATE INDEX "academic_sessions_schoolId_idx" ON "academic_sessions"("schoolId");
CREATE INDEX "academic_terms_sessionId_idx" ON "academic_terms"("sessionId");
CREATE UNIQUE INDEX "school_classes_inviteCode_key" ON "school_classes"("inviteCode");
CREATE INDEX "school_classes_schoolId_idx" ON "school_classes"("schoolId");
CREATE INDEX "school_subjects_schoolId_classId_idx" ON "school_subjects"("schoolId", "classId");
CREATE UNIQUE INDEX "class_enrollments_classId_studentId_key" ON "class_enrollments"("classId", "studentId");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");
CREATE INDEX "users_schoolId_role_idx" ON "users"("schoolId", "role");
CREATE INDEX "users_referralCode_idx" ON "users"("referralCode");
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE UNIQUE INDEX "device_push_tokens_expoPushToken_key" ON "device_push_tokens"("expoPushToken");
CREATE INDEX "device_push_tokens_userId_idx" ON "device_push_tokens"("userId");
CREATE INDEX "usage_tracking_userId_actionType_actionDate_idx" ON "usage_tracking"("userId", "actionType", "actionDate");
CREATE INDEX "notes_userId_idx" ON "notes"("userId");
CREATE INDEX "notes_schoolId_classId_idx" ON "notes"("schoolId", "classId");
CREATE INDEX "quizzes_userId_idx" ON "quizzes"("userId");
CREATE INDEX "quizzes_schoolId_classId_idx" ON "quizzes"("schoolId", "classId");
CREATE INDEX "past_questions_userId_idx" ON "past_questions"("userId");
CREATE INDEX "past_question_topics_pastQuestionId_idx" ON "past_question_topics"("pastQuestionId");
CREATE INDEX "practice_question_sets_userId_idx" ON "practice_question_sets"("userId");
CREATE INDEX "student_studyplans_userId_idx" ON "student_studyplans"("userId");
CREATE INDEX "study_tasks_userId_date_idx" ON "study_tasks"("userId", "date");
CREATE INDEX "attendance_sessions_schoolId_classId_subjectId_idx" ON "attendance_sessions"("schoolId", "classId", "subjectId");
CREATE INDEX "attendance_records_studentId_idx" ON "attendance_records"("studentId");
CREATE UNIQUE INDEX "attendance_records_sessionId_studentId_key" ON "attendance_records"("sessionId", "studentId");
CREATE UNIQUE INDEX "assessment_configs_subjectId_key" ON "assessment_configs"("subjectId");
CREATE INDEX "assessment_configs_schoolId_idx" ON "assessment_configs"("schoolId");
CREATE INDEX "student_subject_grades_schoolId_termId_classId_idx" ON "student_subject_grades"("schoolId", "termId", "classId");
CREATE UNIQUE INDEX "student_subject_grades_termId_subjectId_studentId_key" ON "student_subject_grades"("termId", "subjectId", "studentId");
CREATE INDEX "terminal_report_cards_schoolId_termId_classId_idx" ON "terminal_report_cards"("schoolId", "termId", "classId");
CREATE UNIQUE INDEX "terminal_report_cards_termId_classId_studentId_key" ON "terminal_report_cards"("termId", "classId", "studentId");
CREATE INDEX "school_fee_items_schoolId_idx" ON "school_fee_items"("schoolId");
CREATE UNIQUE INDEX "school_fee_payments_paystackReference_key" ON "school_fee_payments"("paystackReference");
CREATE UNIQUE INDEX "school_fee_payments_receiptQrToken_key" ON "school_fee_payments"("receiptQrToken");
CREATE INDEX "school_fee_payments_studentId_idx" ON "school_fee_payments"("studentId");
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");
CREATE UNIQUE INDEX "wallet_transactions_reference_key" ON "wallet_transactions"("reference");
CREATE INDEX "wallet_transactions_walletId_idx" ON "wallet_transactions"("walletId");
CREATE UNIQUE INDEX "referrals_referredUserId_key" ON "referrals"("referredUserId");
CREATE INDEX "referrals_referrerId_idx" ON "referrals"("referrerId");
CREATE INDEX "withdrawal_requests_userId_status_idx" ON "withdrawal_requests"("userId", "status");
CREATE INDEX "marketplace_items_status_institutionType_idx" ON "marketplace_items"("status", "institutionType");
CREATE INDEX "marketplace_items_schoolId_idx" ON "marketplace_items"("schoolId");
CREATE UNIQUE INDEX "marketplace_purchases_paystackReference_key" ON "marketplace_purchases"("paystackReference");
CREATE UNIQUE INDEX "marketplace_purchases_offlineLicenseToken_key" ON "marketplace_purchases"("offlineLicenseToken");
CREATE INDEX "marketplace_purchases_buyerId_idx" ON "marketplace_purchases"("buyerId");
CREATE UNIQUE INDEX "marketplace_purchases_itemId_buyerId_key" ON "marketplace_purchases"("itemId", "buyerId");
CREATE UNIQUE INDEX "study_communities_inviteCode_key" ON "study_communities"("inviteCode");
CREATE INDEX "study_communities_schoolId_idx" ON "study_communities"("schoolId");
CREATE INDEX "community_channels_communityId_idx" ON "community_channels"("communityId");
CREATE UNIQUE INDEX "community_members_communityId_userId_key" ON "community_members"("communityId", "userId");
CREATE INDEX "community_messages_channelId_createdAt_idx" ON "community_messages"("channelId", "createdAt");
CREATE UNIQUE INDEX "game_matches_inviteCode_key" ON "game_matches"("inviteCode");
CREATE INDEX "game_matches_hostUserId_idx" ON "game_matches"("hostUserId");
CREATE INDEX "game_matches_schoolId_mode_idx" ON "game_matches"("schoolId", "mode");
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schools" ADD CONSTRAINT "schools_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "school_subscription_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_subjects" ADD CONSTRAINT "school_subjects_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_tracking" ADD CONSTRAINT "usage_tracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "past_questions" ADD CONSTRAINT "past_questions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "past_questions" ADD CONSTRAINT "past_questions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "past_question_topics" ADD CONSTRAINT "past_question_topics_pastQuestionId_fkey" FOREIGN KEY ("pastQuestionId") REFERENCES "past_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "practice_question_sets" ADD CONSTRAINT "practice_question_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "practice_question_sets" ADD CONSTRAINT "practice_question_sets_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_studyplans" ADD CONSTRAINT "student_studyplans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_tasks" ADD CONSTRAINT "study_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_tasks" ADD CONSTRAINT "study_tasks_studyPlanId_fkey" FOREIGN KEY ("studyPlanId") REFERENCES "student_studyplans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_configs" ADD CONSTRAINT "assessment_configs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_configs" ADD CONSTRAINT "assessment_configs_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_subject_grades" ADD CONSTRAINT "student_subject_grades_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_subject_grades" ADD CONSTRAINT "student_subject_grades_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_subject_grades" ADD CONSTRAINT "student_subject_grades_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_subject_grades" ADD CONSTRAINT "student_subject_grades_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "school_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_subject_grades" ADD CONSTRAINT "student_subject_grades_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_report_cards" ADD CONSTRAINT "terminal_report_cards_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_report_cards" ADD CONSTRAINT "terminal_report_cards_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_report_cards" ADD CONSTRAINT "terminal_report_cards_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_report_cards" ADD CONSTRAINT "terminal_report_cards_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_fee_items" ADD CONSTRAINT "school_fee_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_fee_items" ADD CONSTRAINT "school_fee_items_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "school_fee_payments" ADD CONSTRAINT "school_fee_payments_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "school_fee_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_fee_payments" ADD CONSTRAINT "school_fee_payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_items" ADD CONSTRAINT "marketplace_items_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_items" ADD CONSTRAINT "marketplace_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketplace_purchases" ADD CONSTRAINT "marketplace_purchases_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "marketplace_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_purchases" ADD CONSTRAINT "marketplace_purchases_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_communities" ADD CONSTRAINT "study_communities_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_communities" ADD CONSTRAINT "study_communities_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_channels" ADD CONSTRAINT "community_channels_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "study_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "study_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "community_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_opponentUserId_fkey" FOREIGN KEY ("opponentUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
