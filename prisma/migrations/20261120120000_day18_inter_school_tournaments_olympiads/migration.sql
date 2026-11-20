-- Day 18: Inter-School Tournaments & Academic Olympiads

-- 1. Create academic_tournaments table
CREATE TABLE IF NOT EXISTS "academic_tournaments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subjectArea" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTRATION_OPEN',
    "targetInstitutionTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedDepartments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowIndependentLearners" BOOLEAN NOT NULL DEFAULT false,
    "maxParticipantsPerSchool" INTEGER NOT NULL DEFAULT 3,
    "maxTotalParticipants" INTEGER NOT NULL DEFAULT 100,
    "requireAdminApproval" BOOLEAN NOT NULL DEFAULT true,
    "questionCount" INTEGER NOT NULL DEFAULT 8,
    "secondsPerQuestion" INTEGER NOT NULL DEFAULT 20,
    "maxTabSwitchesAllowed" INTEGER NOT NULL DEFAULT 2,
    "prizePoolText" TEXT,
    "xpRewardFirst" INTEGER NOT NULL DEFAULT 500,
    "xpRewardSecond" INTEGER NOT NULL DEFAULT 300,
    "xpRewardThird" INTEGER NOT NULL DEFAULT 200,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "hostSchoolId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_tournaments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "academic_tournaments_code_key"
ON "academic_tournaments"("code");

CREATE INDEX IF NOT EXISTS "academic_tournaments_status_startsAt_idx"
ON "academic_tournaments"("status", "startsAt");

-- 2. Create tournament_questions table
CREATE TABLE IF NOT EXISTS "tournament_questions" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "optionsJson" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 100,
    "timeLimitSeconds" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_questions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tournament_questions_tournamentId_orderIndex_key"
ON "tournament_questions"("tournamentId", "orderIndex");

CREATE INDEX IF NOT EXISTS "tournament_questions_tournamentId_idx"
ON "tournament_questions"("tournamentId");

-- 3. Create tournament_entries table
CREATE TABLE IF NOT EXISTS "tournament_entries" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT,
    "registeredById" TEXT,
    "registrationSource" TEXT NOT NULL DEFAULT 'ADMIN_NOMINATED',
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "verifiedInstitutionType" TEXT,
    "verifiedDepartmentName" TEXT,
    "verifiedLevelOrClass" TEXT,
    "verifiedMatricOrAdmissionNo" TEXT,
    "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "totalResponseTimeMs" INTEGER NOT NULL DEFAULT 0,
    "answersJson" JSONB,
    "tabSwitchCount" INTEGER NOT NULL DEFAULT 0,
    "antiCheatFlagsJson" JSONB,
    "disqualificationReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tournament_entries_tournamentId_userId_key"
ON "tournament_entries"("tournamentId", "userId");

CREATE INDEX IF NOT EXISTS "tournament_entries_tournamentId_schoolId_status_idx"
ON "tournament_entries"("tournamentId", "schoolId", "status");

CREATE INDEX IF NOT EXISTS "tournament_entries_tournamentId_totalScore_totalResponseTimeMs_idx"
ON "tournament_entries"("tournamentId", "totalScore", "totalResponseTimeMs");

-- 4. Create tournament_spectator_events table
CREATE TABLE IF NOT EXISTS "tournament_spectator_events" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT,
    "schoolId" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'CHEER',
    "message" TEXT NOT NULL,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_spectator_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tournament_spectator_events_tournamentId_createdAt_idx"
ON "tournament_spectator_events"("tournamentId", "createdAt");

-- 5. Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academic_tournaments_hostSchoolId_fkey') THEN
        ALTER TABLE "academic_tournaments"
            ADD CONSTRAINT "academic_tournaments_hostSchoolId_fkey"
            FOREIGN KEY ("hostSchoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academic_tournaments_createdById_fkey') THEN
        ALTER TABLE "academic_tournaments"
            ADD CONSTRAINT "academic_tournaments_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_questions_tournamentId_fkey') THEN
        ALTER TABLE "tournament_questions"
            ADD CONSTRAINT "tournament_questions_tournamentId_fkey"
            FOREIGN KEY ("tournamentId") REFERENCES "academic_tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_entries_tournamentId_fkey') THEN
        ALTER TABLE "tournament_entries"
            ADD CONSTRAINT "tournament_entries_tournamentId_fkey"
            FOREIGN KEY ("tournamentId") REFERENCES "academic_tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_entries_userId_fkey') THEN
        ALTER TABLE "tournament_entries"
            ADD CONSTRAINT "tournament_entries_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_entries_schoolId_fkey') THEN
        ALTER TABLE "tournament_entries"
            ADD CONSTRAINT "tournament_entries_schoolId_fkey"
            FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_entries_registeredById_fkey') THEN
        ALTER TABLE "tournament_entries"
            ADD CONSTRAINT "tournament_entries_registeredById_fkey"
            FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_spectator_events_tournamentId_fkey') THEN
        ALTER TABLE "tournament_spectator_events"
            ADD CONSTRAINT "tournament_spectator_events_tournamentId_fkey"
            FOREIGN KEY ("tournamentId") REFERENCES "academic_tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_spectator_events_userId_fkey') THEN
        ALTER TABLE "tournament_spectator_events"
            ADD CONSTRAINT "tournament_spectator_events_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_spectator_events_schoolId_fkey') THEN
        ALTER TABLE "tournament_spectator_events"
            ADD CONSTRAINT "tournament_spectator_events_schoolId_fkey"
            FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
