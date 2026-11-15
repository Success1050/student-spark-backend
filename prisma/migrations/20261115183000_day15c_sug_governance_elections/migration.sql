-- Day 15C: SUG Governance Ecosystem, Custom Roles, Live Elections, Public Feed, Welfare Desk & Leader Chat

CREATE TABLE IF NOT EXISTS "sug_role_configs" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "tier" TEXT NOT NULL DEFAULT 'SUG_CENTRAL',
  "unitId" TEXT,
  "departmentId" TEXT,
  "description" TEXT,
  "dueForElection" BOOLEAN NOT NULL DEFAULT false,
  "canViewFinanceReadOnly" BOOLEAN NOT NULL DEFAULT false,
  "canPostPublicUpdates" BOOLEAN NOT NULL DEFAULT true,
  "canPostOpportunities" BOOLEAN NOT NULL DEFAULT false,
  "canManageWelfare" BOOLEAN NOT NULL DEFAULT false,
  "canManageElections" BOOLEAN NOT NULL DEFAULT false,
  "canPostInternal" BOOLEAN NOT NULL DEFAULT true,
  "maxHolders" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_role_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_role_configs_schoolId_tier_isActive_idx"
  ON "sug_role_configs"("schoolId", "tier", "isActive");

ALTER TABLE "sug_role_configs"
  ADD CONSTRAINT "sug_role_configs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_role_configs_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_role_configs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_office_holders" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "unitId" TEXT,
  "departmentId" TEXT,
  "classId" TEXT,
  "tenureLabel" TEXT NOT NULL DEFAULT '2025/2026',
  "manifestoOrBio" TEXT,
  "photoUrl" TEXT,
  "appointedById" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_office_holders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_office_holders_schoolId_isActive_idx"
  ON "sug_office_holders"("schoolId", "isActive");
CREATE INDEX IF NOT EXISTS "sug_office_holders_userId_isActive_idx"
  ON "sug_office_holders"("userId", "isActive");

ALTER TABLE "sug_office_holders"
  ADD CONSTRAINT "sug_office_holders_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_office_holders_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "sug_role_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_office_holders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_office_holders_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_office_holders_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_office_holders_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_elections" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "scopeTier" TEXT NOT NULL DEFAULT 'SUG_CENTRAL',
  "unitId" TEXT,
  "departmentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UPCOMING',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_elections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_elections_schoolId_status_idx"
  ON "sug_elections"("schoolId", "status");

ALTER TABLE "sug_elections"
  ADD CONSTRAINT "sug_elections_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_elections_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "sug_role_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_elections_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_elections_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_election_candidates" (
  "id" TEXT NOT NULL,
  "electionId" TEXT NOT NULL,
  "studentId" TEXT,
  "fullName" TEXT NOT NULL,
  "photoUrl" TEXT,
  "departmentName" TEXT NOT NULL,
  "facultyName" TEXT,
  "levelCode" TEXT NOT NULL DEFAULT '200L',
  "manifesto" TEXT,
  "voteCount" INTEGER NOT NULL DEFAULT 0,
  "isApproved" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_election_candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_election_candidates_electionId_voteCount_idx"
  ON "sug_election_candidates"("electionId", "voteCount");

ALTER TABLE "sug_election_candidates"
  ADD CONSTRAINT "sug_election_candidates_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "sug_elections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_election_candidates_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_election_votes" (
  "id" TEXT NOT NULL,
  "electionId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "voterId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_election_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sug_election_votes_electionId_voterId_key"
  ON "sug_election_votes"("electionId", "voterId");
CREATE INDEX IF NOT EXISTS "sug_election_votes_electionId_candidateId_idx"
  ON "sug_election_votes"("electionId", "candidateId");

ALTER TABLE "sug_election_votes"
  ADD CONSTRAINT "sug_election_votes_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "sug_elections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_election_votes_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "sug_election_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_election_votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_posts" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "authorId" TEXT,
  "authorRoleTitle" TEXT NOT NULL DEFAULT 'SUG Executive',
  "category" TEXT NOT NULL DEFAULT 'UPDATE',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "amountOrStipend" TEXT,
  "deadline" TEXT,
  "externalLink" TEXT,
  "isInternalOnly" BOOLEAN NOT NULL DEFAULT false,
  "isNationwidePublic" BOOLEAN NOT NULL DEFAULT false,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_posts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_posts_schoolId_isInternalOnly_createdAt_idx"
  ON "sug_posts"("schoolId", "isInternalOnly", "createdAt");
CREATE INDEX IF NOT EXISTS "sug_posts_isNationwidePublic_createdAt_idx"
  ON "sug_posts"("isNationwidePublic", "createdAt");

ALTER TABLE "sug_posts"
  ADD CONSTRAINT "sug_posts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_welfare_tickets" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'WELFARE',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "assignedToRole" TEXT,
  "resolutionNote" TEXT,
  "isPublicSummary" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_welfare_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_welfare_tickets_schoolId_status_createdAt_idx"
  ON "sug_welfare_tickets"("schoolId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "sug_welfare_tickets_reporterId_idx"
  ON "sug_welfare_tickets"("reporterId");

ALTER TABLE "sug_welfare_tickets"
  ADD CONSTRAINT "sug_welfare_tickets_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_welfare_tickets_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sug_leader_messages" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "isNationwide" BOOLEAN NOT NULL DEFAULT false,
  "message" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sug_leader_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sug_leader_messages_senderId_recipientId_createdAt_idx"
  ON "sug_leader_messages"("senderId", "recipientId", "createdAt");
CREATE INDEX IF NOT EXISTS "sug_leader_messages_recipientId_readAt_idx"
  ON "sug_leader_messages"("recipientId", "readAt");

ALTER TABLE "sug_leader_messages"
  ADD CONSTRAINT "sug_leader_messages_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_leader_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sug_leader_messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
