-- Alter sug_role_configs for level-based peer selection/endorsement rules
ALTER TABLE "sug_role_configs"
  ADD COLUMN IF NOT EXISTS "isSelectionOpen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "eligibleLevelsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "maxEndorsementWinners" INTEGER NOT NULL DEFAULT 3;

-- Create sug_endorsement_nominees
CREATE TABLE IF NOT EXISTS "sug_endorsement_nominees" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "nomineeUserId" TEXT NOT NULL,
  "nominatedById" TEXT NOT NULL,
  "unitId" TEXT,
  "departmentId" TEXT,
  "fullName" TEXT NOT NULL,
  "photoUrl" TEXT,
  "departmentName" TEXT NOT NULL,
  "facultyName" TEXT,
  "levelCode" TEXT NOT NULL DEFAULT '200L',
  "manifesto" TEXT,
  "endorsementCount" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'PENDING_ENDORSEMENT',
  "approvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_endorsement_nominees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sug_endorsement_nominees_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sug_endorsement_nominees_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "sug_role_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sug_endorsement_nominees_nomineeUserId_fkey" FOREIGN KEY ("nomineeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sug_endorsement_nominees_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sug_endorsement_nominees_roleId_nomineeUserId_key"
  ON "sug_endorsement_nominees"("roleId", "nomineeUserId");

CREATE INDEX IF NOT EXISTS "sug_endorsement_nominees_schoolId_roleId_endorsementCount_idx"
  ON "sug_endorsement_nominees"("schoolId", "roleId", "endorsementCount");

-- Create sug_endorsement_votes
CREATE TABLE IF NOT EXISTS "sug_endorsement_votes" (
  "id" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "nomineeId" TEXT NOT NULL,
  "voterId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_endorsement_votes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sug_endorsement_votes_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "sug_role_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sug_endorsement_votes_nomineeId_fkey" FOREIGN KEY ("nomineeId") REFERENCES "sug_endorsement_nominees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sug_endorsement_votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sug_endorsement_votes_roleId_voterId_key"
  ON "sug_endorsement_votes"("roleId", "voterId");

CREATE INDEX IF NOT EXISTS "sug_endorsement_votes_nomineeId_idx"
  ON "sug_endorsement_votes"("nomineeId");
