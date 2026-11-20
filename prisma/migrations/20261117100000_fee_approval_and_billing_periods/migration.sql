-- AlterTable
ALTER TABLE "fee_structures" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "fee_structures" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "fee_structures" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "fee_structures" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "fee_structures" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT NOT NULL DEFAULT 'PER_SESSION';

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_structures_approvedById_fkey'
  ) THEN
    ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
