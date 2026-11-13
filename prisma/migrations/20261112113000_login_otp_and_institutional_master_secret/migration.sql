-- AlterTable: schools (add masterSecretKey and secretKeyCreatedAt)
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "masterSecretKey" TEXT;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "secretKeyCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "schools_masterSecretKey_key" ON "schools"("masterSecretKey");

-- CreateTable: login_otps
CREATE TABLE IF NOT EXISTS "login_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tempTicket" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "login_otps_tempTicket_key" ON "login_otps"("tempTicket");
CREATE INDEX IF NOT EXISTS "login_otps_tempTicket_idx" ON "login_otps"("tempTicket");
CREATE INDEX IF NOT EXISTS "login_otps_userId_idx" ON "login_otps"("userId");

-- Foreign Keys
DO $$ BEGIN
    ALTER TABLE "login_otps" ADD CONSTRAINT "login_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
