-- Day 17: Dual-Zone Communities (My Campus + Cross-School Connect) & 1v1 Direct Messages

-- 1. Extend study_communities
ALTER TABLE "study_communities"
ADD COLUMN IF NOT EXISTS "zone" TEXT NOT NULL DEFAULT 'MY_CAMPUS',
ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN IF NOT EXISTS "unitId" TEXT,
ADD COLUMN IF NOT EXISTS "departmentId" TEXT,
ADD COLUMN IF NOT EXISTS "classId" TEXT,
ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "study_communities_zone_schoolId_idx"
ON "study_communities"("zone", "schoolId");

-- 2. Extend community_channels
ALTER TABLE "community_channels"
ADD COLUMN IF NOT EXISTS "channelType" TEXT NOT NULL DEFAULT 'TEXT',
ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "isReadOnlyForStudents" BOOLEAN NOT NULL DEFAULT false;

-- 3. Extend community_messages
ALTER TABLE "community_messages"
ADD COLUMN IF NOT EXISTS "replyToId" TEXT,
ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "reactionsJson" JSONB;

-- 4. Create direct_conversations table
CREATE TABLE IF NOT EXISTS "direct_conversations" (
    "id" TEXT NOT NULL,
    "participantAId" TEXT NOT NULL,
    "participantBId" TEXT NOT NULL,
    "lastMessageText" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastSenderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "direct_conversations_participantAId_participantBId_key"
ON "direct_conversations"("participantAId", "participantBId");

CREATE INDEX IF NOT EXISTS "direct_conversations_participantAId_lastMessageAt_idx"
ON "direct_conversations"("participantAId", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "direct_conversations_participantBId_lastMessageAt_idx"
ON "direct_conversations"("participantBId", "lastMessageAt");

-- 5. Create direct_messages table
CREATE TABLE IF NOT EXISTS "direct_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentType" TEXT,
    "attachmentId" TEXT,
    "attachmentMeta" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "direct_messages_conversationId_createdAt_idx"
ON "direct_messages"("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "direct_messages_senderId_idx"
ON "direct_messages"("senderId");

-- 6. Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_messages_replyToId_fkey') THEN
        ALTER TABLE "community_messages"
            ADD CONSTRAINT "community_messages_replyToId_fkey"
            FOREIGN KEY ("replyToId") REFERENCES "community_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_conversations_participantAId_fkey') THEN
        ALTER TABLE "direct_conversations"
            ADD CONSTRAINT "direct_conversations_participantAId_fkey"
            FOREIGN KEY ("participantAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_conversations_participantBId_fkey') THEN
        ALTER TABLE "direct_conversations"
            ADD CONSTRAINT "direct_conversations_participantBId_fkey"
            FOREIGN KEY ("participantBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_conversationId_fkey') THEN
        ALTER TABLE "direct_messages"
            ADD CONSTRAINT "direct_messages_conversationId_fkey"
            FOREIGN KEY ("conversationId") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_messages_senderId_fkey') THEN
        ALTER TABLE "direct_messages"
            ADD CONSTRAINT "direct_messages_senderId_fkey"
            FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
