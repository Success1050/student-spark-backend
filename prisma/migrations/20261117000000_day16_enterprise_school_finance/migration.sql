-- Day 16: Enterprise Institution Finance Portal (SCHOOL_FINANCE), 4 Payment Channels & Digital Clearance

-- 1. Payment Accounts
CREATE TABLE IF NOT EXISTS "payment_accounts" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "bankCode" TEXT,
  "accountType" TEXT NOT NULL DEFAULT 'CENTRAL_BURSARY',
  "unitId" TEXT,
  "departmentId" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "paystackSubaccountCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_accounts_schoolId_isActive_idx"
  ON "payment_accounts"("schoolId", "isActive");

ALTER TABLE "payment_accounts"
  ADD CONSTRAINT "payment_accounts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_accounts_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_accounts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Fee Structures
CREATE TABLE IF NOT EXISTS "fee_structures" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sessionName" TEXT NOT NULL DEFAULT '2025/2026',
  "termId" TEXT,
  "termOrSemester" TEXT,
  "targetScope" TEXT NOT NULL DEFAULT 'WHOLE_SCHOOL',
  "unitId" TEXT,
  "departmentId" TEXT,
  "classId" TEXT,
  "levelName" TEXT,
  "paymentAccountId" TEXT,
  "dueDate" TIMESTAMP(3),
  "isMandatory" BOOLEAN NOT NULL DEFAULT true,
  "allowPartialPayment" BOOLEAN NOT NULL DEFAULT true,
  "minimumPartialKobo" INTEGER NOT NULL DEFAULT 0,
  "totalAmountKobo" INTEGER NOT NULL DEFAULT 0,
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fee_structures_schoolId_targetScope_isPublished_idx"
  ON "fee_structures"("schoolId", "targetScope", "isPublished");

ALTER TABLE "fee_structures"
  ADD CONSTRAINT "fee_structures_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "fee_structures_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fee_structures_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fee_structures_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fee_structures_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fee_structures_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fee_structures_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Fee Items
CREATE TABLE IF NOT EXISTS "fee_items" (
  "id" TEXT NOT NULL,
  "feeStructureId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountKobo" INTEGER NOT NULL,
  "isOptional" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fee_items_feeStructureId_idx"
  ON "fee_items"("feeStructureId");

ALTER TABLE "fee_items"
  ADD CONSTRAINT "fee_items_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Student Invoices
CREATE TABLE IF NOT EXISTS "student_invoices" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "feeStructureId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "totalAmountKobo" INTEGER NOT NULL,
  "paidAmountKobo" INTEGER NOT NULL DEFAULT 0,
  "balanceAmountKobo" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNPAID',
  "dueDate" TIMESTAMP(3),
  "clearedAt" TIMESTAMP(3),
  "qrClearanceToken" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "student_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_invoices_invoiceNumber_key" UNIQUE ("invoiceNumber"),
  CONSTRAINT "student_invoices_qrClearanceToken_key" UNIQUE ("qrClearanceToken")
);

CREATE INDEX IF NOT EXISTS "student_invoices_schoolId_studentId_status_idx"
  ON "student_invoices"("schoolId", "studentId", "status");
CREATE INDEX IF NOT EXISTS "student_invoices_schoolId_feeStructureId_idx"
  ON "student_invoices"("schoolId", "feeStructureId");

ALTER TABLE "student_invoices"
  ADD CONSTRAINT "student_invoices_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "student_invoices_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "student_invoices_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Finance Payments
CREATE TABLE IF NOT EXISTS "finance_payments" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "paymentAccountId" TEXT,
  "amountKobo" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'PAYSTACK',
  "status" TEXT NOT NULL DEFAULT 'VERIFIED',
  "reference" TEXT NOT NULL,
  "paystackReference" TEXT,
  "posTerminalRef" TEXT,
  "bankTellerNo" TEXT,
  "recordedById" TEXT,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "receiptNumber" TEXT,
  "qrReceiptToken" TEXT,
  "metadataJson" JSONB,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "finance_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_payments_reference_key" UNIQUE ("reference"),
  CONSTRAINT "finance_payments_paystackReference_key" UNIQUE ("paystackReference"),
  CONSTRAINT "finance_payments_receiptNumber_key" UNIQUE ("receiptNumber"),
  CONSTRAINT "finance_payments_qrReceiptToken_key" UNIQUE ("qrReceiptToken")
);

CREATE INDEX IF NOT EXISTS "finance_payments_schoolId_studentId_channel_idx"
  ON "finance_payments"("schoolId", "studentId", "channel");
CREATE INDEX IF NOT EXISTS "finance_payments_schoolId_paidAt_idx"
  ON "finance_payments"("schoolId", "paidAt");

ALTER TABLE "finance_payments"
  ADD CONSTRAINT "finance_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "student_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_payments_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_payments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Payment Allocations
CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "feeItemId" TEXT NOT NULL,
  "amountKobo" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_allocations_paymentId_idx"
  ON "payment_allocations"("paymentId");
CREATE INDEX IF NOT EXISTS "payment_allocations_feeItemId_idx"
  ON "payment_allocations"("feeItemId");

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "finance_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_allocations_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "fee_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Payment Evidence (Bank Transfer Proofs)
CREATE TABLE IF NOT EXISTS "payment_evidences" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT,
  "invoiceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "payerName" TEXT NOT NULL,
  "payerBankName" TEXT,
  "transferAmountKobo" INTEGER NOT NULL,
  "transferDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proofImageUrl" TEXT NOT NULL,
  "submissionNotes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_evidences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_evidences_paymentId_key" UNIQUE ("paymentId")
);

CREATE INDEX IF NOT EXISTS "payment_evidences_invoiceId_status_idx"
  ON "payment_evidences"("invoiceId", "status");
CREATE INDEX IF NOT EXISTS "payment_evidences_studentId_status_idx"
  ON "payment_evidences"("studentId", "status");

ALTER TABLE "payment_evidences"
  ADD CONSTRAINT "payment_evidences_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "finance_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_evidences_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "student_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_evidences_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_evidences_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Reconciliation Batches
CREATE TABLE IF NOT EXISTS "reconciliation_batches" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "paymentAccountId" TEXT,
  "uploadedById" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "matchedRows" INTEGER NOT NULL DEFAULT 0,
  "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
  "totalAmountKobo" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "resultsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reconciliation_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reconciliation_batches_schoolId_createdAt_idx"
  ON "reconciliation_batches"("schoolId", "createdAt");

ALTER TABLE "reconciliation_batches"
  ADD CONSTRAINT "reconciliation_batches_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reconciliation_batches_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "reconciliation_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. Finance Receipts
CREATE TABLE IF NOT EXISTS "finance_receipts" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "qrToken" TEXT NOT NULL,
  "amountKobo" INTEGER NOT NULL,
  "payerFullName" TEXT NOT NULL,
  "payerMatricOrAdmissionNo" TEXT,
  "academicSession" TEXT NOT NULL,
  "feeCategory" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "finance_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_receipts_paymentId_key" UNIQUE ("paymentId"),
  CONSTRAINT "finance_receipts_receiptNumber_key" UNIQUE ("receiptNumber"),
  CONSTRAINT "finance_receipts_qrToken_key" UNIQUE ("qrToken")
);

CREATE INDEX IF NOT EXISTS "finance_receipts_schoolId_studentId_idx"
  ON "finance_receipts"("schoolId", "studentId");
CREATE INDEX IF NOT EXISTS "finance_receipts_receiptNumber_idx"
  ON "finance_receipts"("receiptNumber");
CREATE INDEX IF NOT EXISTS "finance_receipts_qrToken_idx"
  ON "finance_receipts"("qrToken");

ALTER TABLE "finance_receipts"
  ADD CONSTRAINT "finance_receipts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "finance_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_receipts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "student_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_receipts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. Financial Audit Logs
CREATE TABLE IF NOT EXISTS "financial_audit_logs" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "amountKobo" INTEGER,
  "diffJson" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "financial_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "financial_audit_logs_schoolId_action_createdAt_idx"
  ON "financial_audit_logs"("schoolId", "action", "createdAt");
CREATE INDEX IF NOT EXISTS "financial_audit_logs_actorId_createdAt_idx"
  ON "financial_audit_logs"("actorId", "createdAt");

ALTER TABLE "financial_audit_logs"
  ADD CONSTRAINT "financial_audit_logs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "financial_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
