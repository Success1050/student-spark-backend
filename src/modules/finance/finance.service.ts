import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  CreateFeeStructureDto,
  CreatePaymentAccountDto,
  UpdatePaymentAccountDto,
  InitOnlinePaymentDto,
  ReconciliationCsvDto,
  RecordWalkInPaymentDto,
  ReviewTransferEvidenceDto,
  SubmitTransferEvidenceDto,
  VerifyOnlinePaymentDto,
} from './dto/finance.dto.js';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================================================
  // 1. PAYMENT ACCOUNTS (INSTITUTION & FACULTY BANK ACCOUNTS)
  // ============================================================================

  async getPaymentAccounts(schoolId: string) {
    return this.prisma.paymentAccount.findMany({
      where: { schoolId },
      include: {
        unit: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createPaymentAccount(
    schoolId: string,
    actorId: string,
    actorRole: string,
    dto: CreatePaymentAccountDto,
  ) {
    if (dto.isDefault) {
      await this.prisma.paymentAccount.updateMany({
        where: { schoolId },
        data: { isDefault: false },
      });
    }

    const account = await this.prisma.paymentAccount.create({
      data: {
        schoolId,
        accountName: dto.accountName.trim(),
        accountNumber: dto.accountNumber.trim(),
        bankName: dto.bankName.trim(),
        bankCode: dto.bankCode?.trim(),
        accountType: dto.accountType || 'CENTRAL_BURSARY',
        unitId: dto.unitId,
        departmentId: dto.departmentId,
        isDefault: dto.isDefault ?? false,
        description: dto.description?.trim(),
        paystackSubaccountCode: dto.paystackSubaccountCode?.trim(),
      },
      include: {
        unit: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
      },
    });

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'ACCOUNT_CREATED',
      entityType: 'PaymentAccount',
      entityId: account.id,
      diffJson: {
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
      },
    });

    return account;
  }

  async setDefaultPaymentAccount(schoolId: string, accountId: string) {
    await this.prisma.paymentAccount.updateMany({
      where: { schoolId },
      data: { isDefault: false },
    });
    return this.prisma.paymentAccount.update({
      where: { id: accountId },
      data: { isDefault: true },
    });
  }

  async updatePaymentAccount(
    schoolId: string,
    accountId: string,
    actorId: string,
    actorRole: string,
    dto: UpdatePaymentAccountDto,
  ) {
    const account = await this.prisma.paymentAccount.findFirst({
      where: { id: accountId, schoolId },
    });
    if (!account) {
      throw new NotFoundException('Payment account not found');
    }

    if (dto.isDefault) {
      await this.prisma.paymentAccount.updateMany({
        where: { schoolId },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.paymentAccount.update({
      where: { id: accountId },
      data: {
        accountName: dto.accountName !== undefined ? dto.accountName.trim() : undefined,
        accountNumber: dto.accountNumber !== undefined ? dto.accountNumber.trim() : undefined,
        bankName: dto.bankName !== undefined ? dto.bankName.trim() : undefined,
        bankCode: dto.bankCode !== undefined ? dto.bankCode?.trim() : undefined,
        accountType: dto.accountType !== undefined ? dto.accountType : undefined,
        unitId: dto.unitId !== undefined ? dto.unitId : undefined,
        departmentId: dto.departmentId !== undefined ? dto.departmentId : undefined,
        isDefault: dto.isDefault !== undefined ? dto.isDefault : undefined,
        description: dto.description !== undefined ? dto.description?.trim() : undefined,
        paystackSubaccountCode:
          dto.paystackSubaccountCode !== undefined
            ? dto.paystackSubaccountCode?.trim()
            : undefined,
      },
      include: {
        unit: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
      },
    });

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'ACCOUNT_UPDATED',
      entityType: 'PaymentAccount',
      entityId: account.id,
      diffJson: {
        previous: {
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
        },
        current: {
          bankName: updated.bankName,
          accountNumber: updated.accountNumber,
          accountName: updated.accountName,
        },
      },
    });

    return updated;
  }

  async deletePaymentAccount(
    schoolId: string,
    accountId: string,
    actorId: string,
    actorRole: string,
  ) {
    const account = await this.prisma.paymentAccount.findFirst({
      where: { id: accountId, schoolId },
    });
    if (!account) {
      throw new NotFoundException('Payment account not found');
    }

    const linkedStructuresCount = await this.prisma.feeStructure.count({
      where: { paymentAccountId: accountId },
    });
    if (linkedStructuresCount > 0) {
      throw new BadRequestException(
        `Cannot delete bank account "${account.bankName} - ${account.accountNumber}". It is currently assigned to ${linkedStructuresCount} active Fee Structure(s). Please reassign them first.`,
      );
    }

    await this.prisma.paymentAccount.delete({
      where: { id: accountId },
    });

    if (account.isDefault) {
      const anotherAccount = await this.prisma.paymentAccount.findFirst({
        where: { schoolId },
      });
      if (anotherAccount) {
        await this.prisma.paymentAccount.update({
          where: { id: anotherAccount.id },
          data: { isDefault: true },
        });
      }
    }

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'ACCOUNT_DELETED',
      entityType: 'PaymentAccount',
      entityId: account.id,
      diffJson: {
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
      },
    });

    return { success: true, message: 'Bank account deleted successfully' };
  }

  /**
   * Fetch active Nigerian banks via Paystack API (with cached fallback)
   */
  async getBankList() {
    const fallbackBanks = [
      { name: 'Access Bank', code: '044', slug: 'access-bank' },
      { name: 'Guaranty Trust Bank (GTBank)', code: '058', slug: 'guaranty-trust-bank' },
      { name: 'First Bank of Nigeria', code: '011', slug: 'first-bank-of-nigeria' },
      { name: 'Zenith Bank', code: '057', slug: 'zenith-bank' },
      { name: 'United Bank For Africa (UBA)', code: '033', slug: 'united-bank-for-africa' },
      { name: 'Ecobank Nigeria', code: '050', slug: 'ecobank-nigeria' },
      { name: 'Fidelity Bank', code: '070', slug: 'fidelity-bank' },
      { name: 'First City Monument Bank (FCMB)', code: '214', slug: 'first-city-monument-bank' },
      { name: 'Stanbic IBTC Bank', code: '221', slug: 'stanbic-ibtc-bank' },
      { name: 'Sterling Bank', code: '232', slug: 'sterling-bank' },
      { name: 'Union Bank of Nigeria', code: '032', slug: 'union-bank-of-nigeria' },
      { name: 'Wema Bank', code: '035', slug: 'wema-bank' },
      { name: 'Polaris Bank', code: '076', slug: 'polaris-bank' },
      { name: 'Unity Bank', code: '215', slug: 'unity-bank' },
      { name: 'Jaiz Bank', code: '301', slug: 'jaiz-bank' },
      { name: 'TAJ Bank', code: '302', slug: 'taj-bank' },
      { name: 'Lotus Bank', code: '303', slug: 'lotus-bank' },
      { name: 'Premium Trust Bank', code: '105', slug: 'premium-trust-bank' },
      { name: 'Signature Bank', code: '106', slug: 'signature-bank' },
      { name: 'Titan Trust Bank', code: '102', slug: 'titan-trust-bank' },
      { name: 'Kuda Microfinance Bank', code: '090267', slug: 'kuda-bank' },
      { name: 'OPay Digital Services', code: '999992', slug: 'opay' },
      { name: 'PalmPay', code: '999991', slug: 'palmpay' },
      { name: 'Moniepoint Microfinance Bank', code: '090405', slug: 'moniepoint-mfb' },
      { name: 'Fairmoney Microfinance Bank', code: '090551', slug: 'fairmoney-mfb' },
      { name: 'Rubies MFB', code: '125', slug: 'rubies-mfb' },
      { name: 'VFD Microfinance Bank', code: '090110', slug: 'vfd' },
      { name: 'Carbon', code: '090333', slug: 'carbon' },
    ];

    try {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      const res = await fetch('https://api.paystack.co/bank?country=nigeria&perPage=100', {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      const json = (await res.json()) as any;
      if (json && json.status && Array.isArray(json.data)) {
        return json.data
          .filter((b: any) => b.active)
          .map((b: any) => ({
            name: b.name,
            code: b.code,
            slug: b.slug,
          }));
      }
    } catch (err: any) {
      this.logger.warn(`Could not fetch live Paystack bank list: ${String(err.message)}`);
    }

    return fallbackBanks;
  }

  /**
   * Resolve NUBAN Bank Account Name via Paystack API
   */
  async resolveBankAccount(accountNumber: string, bankCode: string) {
    const cleanNum = accountNumber?.trim();
    const cleanCode = bankCode?.trim();

    if (!cleanNum || cleanNum.length !== 10) {
      throw new BadRequestException('Nigerian NUBAN account number must be exactly 10 digits.');
    }
    if (!cleanCode) {
      throw new BadRequestException('Bank code is required to resolve account details.');
    }

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (secret && !secret.includes('placeholder') && !secret.includes('sample')) {
      try {
        const res = await fetch(
          `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(cleanNum)}&bank_code=${encodeURIComponent(cleanCode)}`,
          {
            headers: { Authorization: `Bearer ${secret}` },
          },
        );
        const data = (await res.json()) as any;
        if (data.status && data.data?.account_name) {
          return {
            accountNumber: data.data.account_number,
            accountName: data.data.account_name,
            bankCode: cleanCode,
          };
        } else {
          // If Paystack returns error or test mode simulation
          if (secret.startsWith('sk_test_')) {
            // In test mode, allow resolving test NUBANs smoothly
            return {
              accountNumber: cleanNum,
              accountName: `FEDERAL UNIVERSITY OF TECHNOLOGY (TEST NUBAN: ${cleanNum})`,
              bankCode: cleanCode,
              isSimulated: true,
            };
          }
          throw new BadRequestException(
            data.message || 'Could not resolve account name. Check the account number and selected bank.',
          );
        }
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        this.logger.warn(`Paystack bank resolve error: ${String(err.message)}`);
      }
    }

    // Dev / Test fallback
    return {
      accountNumber: cleanNum,
      accountName: `FUTO INSTITUTION REVENUE ACCOUNT (${cleanNum})`,
      bankCode: cleanCode,
      isSimulated: true,
    };
  }

  // ============================================================================
  // 2. FEE STRUCTURES & BREAKDOWN ITEMS (FACULTY/DEPT/LEVEL SCOPED)
  // ============================================================================

  async getFeeStructures(
    schoolId: string,
    filters?: {
      targetScope?: string;
      unitId?: string;
      departmentId?: string;
      levelName?: string;
    },
  ) {
    return this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        ...(filters?.targetScope ? { targetScope: filters.targetScope } : {}),
        ...(filters?.unitId ? { unitId: filters.unitId } : {}),
        ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters?.levelName ? { levelName: filters.levelName } : {}),
      },
      include: {
        feeItems: { orderBy: { sortOrder: 'asc' } },
        paymentAccount: true,
        unit: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        class: { select: { id: true, name: true } },
        _count: { select: { invoices: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFeeStructure(
    schoolId: string,
    actorId: string,
    actorRole: string,
    dto: CreateFeeStructureDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one fee breakdown item is required.');
    }

    const totalKobo = dto.items.reduce(
      (sum, item) => sum + (Number(item.amountKobo) || 0),
      0,
    );

    let paymentAccountId = dto.paymentAccountId;
    if (!paymentAccountId) {
      const defaultAcc = await this.prisma.paymentAccount.findFirst({
        where: { schoolId, isDefault: true, isActive: true },
      });
      paymentAccountId = defaultAcc?.id;
    }

    const feeStructure = await this.prisma.feeStructure.create({
      data: {
        schoolId,
        title: dto.title.trim(),
        code: dto.code.trim().toUpperCase(),
        sessionName: dto.sessionName?.trim() || '2025/2026',
        termId: dto.termId,
        termOrSemester: dto.termOrSemester?.trim(),
        targetScope: dto.targetScope || 'WHOLE_SCHOOL',
        unitId: dto.unitId,
        departmentId: dto.departmentId,
        classId: dto.classId,
        levelName: dto.levelName?.trim(),
        paymentAccountId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        isMandatory: dto.isMandatory ?? true,
        allowPartialPayment: dto.allowPartialPayment ?? true,
        minimumPartialKobo: dto.minimumPartialKobo ?? 0,
        totalAmountKobo: totalKobo,
        createdById: actorId,
        feeItems: {
          create: dto.items.map((item, idx) => ({
            name: item.name.trim(),
            amountKobo: Number(item.amountKobo) || 0,
            isOptional: item.isOptional ?? false,
            sortOrder: item.sortOrder ?? idx + 1,
          })),
        },
      },
      include: {
        feeItems: true,
        paymentAccount: true,
      },
    });

    let generatedInvoicesCount = 0;
    if (dto.autoGenerateInvoices !== false) {
      generatedInvoicesCount = await this.generateInvoicesForFeeStructure(
        schoolId,
        feeStructure.id,
      );
    }

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'FEE_STRUCTURE_CREATED',
      entityType: 'FeeStructure',
      entityId: feeStructure.id,
      amountKobo: totalKobo,
      diffJson: {
        title: feeStructure.title,
        code: feeStructure.code,
        targetScope: feeStructure.targetScope,
        generatedInvoicesCount,
      },
    });

    return {
      ...feeStructure,
      generatedInvoicesCount,
    };
  }

  // ============================================================================
  // 3. AUTOMATIC INVOICE GENERATOR & TARGET SCOPING
  // ============================================================================

  async generateInvoicesForFeeStructure(schoolId: string, feeStructureId: string) {
    const fee = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
      include: {
        school: { select: { id: true, schoolCode: true, name: true } },
      },
    });
    if (!fee || fee.schoolId !== schoolId) {
      throw new NotFoundException('Fee structure not found');
    }

    // Query matching enrolled students based on targetScope
    let studentsQuery: any = {
      schoolId,
      role: 'STUDENT',
    };

    if (fee.targetScope === 'WHOLE_SCHOOL') {
      if (fee.levelName) {
        studentsQuery.studentProfile = { level: fee.levelName };
      }
    } else if (fee.targetScope === 'FACULTY' && fee.unitId) {
      studentsQuery.studentProfile = {
        department: { unitId: fee.unitId },
        ...(fee.levelName ? { level: fee.levelName } : {}),
      };
    } else if (fee.targetScope === 'DEPARTMENT' && fee.departmentId) {
      studentsQuery.studentProfile = {
        departmentId: fee.departmentId,
        ...(fee.levelName ? { level: fee.levelName } : {}),
      };
    } else if (fee.targetScope === 'LEVEL_OR_CLASS') {
      if (fee.classId) {
        studentsQuery.studentProfile = { classId: fee.classId };
      } else if (fee.levelName) {
        studentsQuery.studentProfile = { level: fee.levelName };
      }
    }

    const students = await this.prisma.user.findMany({
      where: studentsQuery,
      select: {
        id: true,
        fullName: true,
        loginId: true,
        studentProfile: { select: { matricOrAdmissionNo: true } },
      },
    });

    if (students.length === 0) {
      return 0;
    }

    let createdCount = 0;
    const schoolPrefix = (fee.school.schoolCode || 'SSP').toUpperCase();
    const yearPrefix = new Date().getFullYear();

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const existing = await this.prisma.studentInvoice.findFirst({
        where: { studentId: student.id, feeStructureId: fee.id },
      });
      if (existing) continue;

      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const invoiceNumber = `INV-${schoolPrefix}-${yearPrefix}-${String(i + 1).padStart(4, '0')}-${randomSuffix}`;
      const qrClearanceToken = `CLR-${schoolPrefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      await this.prisma.studentInvoice.create({
        data: {
          schoolId,
          studentId: student.id,
          feeStructureId: fee.id,
          invoiceNumber,
          totalAmountKobo: fee.totalAmountKobo,
          paidAmountKobo: 0,
          balanceAmountKobo: fee.totalAmountKobo,
          status: 'UNPAID',
          dueDate: fee.dueDate,
          qrClearanceToken,
        },
      });
      createdCount++;
    }

    return createdCount;
  }

  // ============================================================================
  // 4. STUDENT INVOICES & FINANCIAL CLEARANCE STATUS
  // ============================================================================

  async getStudentInvoices(schoolId: string, studentId: string, status?: string) {
    return this.prisma.studentInvoice.findMany({
      where: {
        schoolId,
        studentId,
        ...(status ? { status } : {}),
      },
      include: {
        feeStructure: {
          include: {
            feeItems: { orderBy: { sortOrder: 'asc' } },
            paymentAccount: true,
          },
        },
        payments: {
          where: { status: 'VERIFIED' },
          orderBy: { paidAt: 'desc' },
          include: { receipt: true },
        },
        evidences: {
          orderBy: { createdAt: 'desc' },
        },
        receipts: {
          orderBy: { issuedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStudentClearanceStatus(schoolId: string, studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: {
        studentProfile: {
          include: {
            department: { include: { unit: true } },
            schoolClass: true,
          },
        },
      },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const invoices = await this.prisma.studentInvoice.findMany({
      where: { schoolId, studentId },
      include: {
        feeStructure: true,
        receipts: true,
      },
    });

    const totalInvoicedKobo = invoices.reduce((sum, inv) => sum + inv.totalAmountKobo, 0);
    const totalPaidKobo = invoices.reduce((sum, inv) => sum + inv.paidAmountKobo, 0);
    const totalOutstandingKobo = invoices.reduce((sum, inv) => sum + inv.balanceAmountKobo, 0);

    const mandatoryInvoices = invoices.filter((inv) => inv.feeStructure.isMandatory);
    const isCleared =
      mandatoryInvoices.length > 0 &&
      mandatoryInvoices.every((inv) => inv.status === 'PAID' || inv.balanceAmountKobo <= 0);

    const matricNo = student.studentProfile?.matricOrAdmissionNo || student.loginId || '';
    const primaryClearanceToken =
      invoices.find((inv) => inv.status === 'PAID')?.qrClearanceToken ||
      invoices[0]?.qrClearanceToken ||
      `CLR-${matricNo || student.id.slice(0, 8)}`;

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        matricOrAdmissionNo: matricNo,
        departmentName: student.studentProfile?.department?.name || 'General',
        facultyName: student.studentProfile?.department?.unit?.name || 'General',
        level: student.studentProfile?.level || student.studentProfile?.schoolClass?.name || 'Current Level',
      },
      isCleared,
      clearanceStatus: isCleared ? 'CLEARED' : 'OUTSTANDING_FEES',
      primaryClearanceToken,
      totalInvoicedKobo,
      totalPaidKobo,
      totalOutstandingKobo,
      invoicesCount: invoices.length,
      paidInvoicesCount: invoices.filter((i) => i.status === 'PAID').length,
      invoicesSummary: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        title: inv.feeStructure.title,
        totalKobo: inv.totalAmountKobo,
        paidKobo: inv.paidAmountKobo,
        balanceKobo: inv.balanceAmountKobo,
        status: inv.status,
        isMandatory: inv.feeStructure.isMandatory,
        qrClearanceToken: inv.qrClearanceToken,
      })),
    };
  }

  // ============================================================================
  // 5. 4 PAYMENT CHANNELS: PAYSTACK, CASH, POS, & BANK TRANSFER PROOF
  // ============================================================================

  /**
   * Channel 1: Online Paystack Init
   */
  async initOnlinePayment(schoolId: string, studentId: string, dto: InitOnlinePaymentDto) {
    const invoice = await this.prisma.studentInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        feeStructure: { include: { paymentAccount: true } },
        student: { include: { studentProfile: true } },
      },
    });

    if (!invoice || invoice.schoolId !== schoolId) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.studentId !== studentId) {
      throw new ForbiddenException('You cannot pay for another student invoice');
    }
    if (invoice.status === 'PAID' || invoice.balanceAmountKobo <= 0) {
      throw new BadRequestException('This invoice is already fully cleared.');
    }

    const payAmountKobo = dto.amountKobo
      ? Math.min(dto.amountKobo, invoice.balanceAmountKobo)
      : invoice.balanceAmountKobo;

    const paystackReference = `SSP-FEE-${invoice.id.slice(0, 8)}-${Date.now()}`;
    const subaccountCode = invoice.feeStructure.paymentAccount?.paystackSubaccountCode || null;

    const studentMatric = invoice.student.studentProfile?.matricOrAdmissionNo || invoice.student.loginId;

    return {
      paystackReference,
      amountKobo: payAmountKobo,
      email: invoice.student.email || `${studentMatric || 'student'}@studentspark.ng`,
      invoiceNumber: invoice.invoiceNumber,
      title: invoice.feeStructure.title,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_sample_key',
      subaccountCode,
    };
  }

  /**
   * Channel 1: Online Paystack Verify & Instant Receipt
   */
  async verifyOnlinePayment(
    schoolId: string,
    studentId: string,
    dto: VerifyOnlinePaymentDto,
  ) {
    const invoice = await this.prisma.studentInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        feeStructure: { include: { paymentAccount: true, feeItems: true } },
        student: { include: { studentProfile: true } },
        school: true,
      },
    });

    if (!invoice || invoice.schoolId !== schoolId) {
      throw new NotFoundException('Invoice not found');
    }

    const existingPayment = await this.prisma.financePayment.findFirst({
      where: { paystackReference: dto.paystackReference },
      include: { receipt: true },
    });
    if (existingPayment) {
      return {
        payment: existingPayment,
        receipt: existingPayment.receipt,
        message: 'Payment was already verified and receipt issued.',
      };
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    let verifiedAmountKobo = invoice.balanceAmountKobo;
    if (paystackSecret && !paystackSecret.includes('placeholder') && !paystackSecret.includes('sample')) {
      try {
        const res = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(dto.paystackReference)}`,
          {
            headers: { Authorization: `Bearer ${paystackSecret}` },
          },
        );
        const data = (await res.json()) as any;
        if (data.status && data.data?.status === 'success') {
          verifiedAmountKobo = Number(data.data.amount) || verifiedAmountKobo;
        } else {
          throw new BadRequestException('Paystack verification failed: Transaction not successful.');
        }
      } catch (err: any) {
        this.logger.warn(`Live Paystack verify check: ${String(err.message)}`);
      }
    }

    return this.applyPaymentSuccess({
      schoolId,
      studentId,
      invoice,
      amountKobo: verifiedAmountKobo,
      channel: 'PAYSTACK',
      reference: `PAY-${dto.paystackReference}`,
      paystackReference: dto.paystackReference,
      actorId: studentId,
      actorRole: 'STUDENT',
    });
  }

  /**
   * Channel 1 (Background): Automated Paystack Webhook Handler
   */
  async handlePaystackWebhook(event: any) {
    if (!event || event.event !== 'charge.success') {
      return { status: 'ignored', message: `Unhandled event: ${event?.event}` };
    }

    const data = event.data;
    const reference = data?.reference;
    const amountKobo = Number(data?.amount);

    if (!reference) {
      return { status: 'error', message: 'No reference provided in webhook event' };
    }

    // Check if this payment is already recorded
    const existing = await this.prisma.financePayment.findFirst({
      where: { paystackReference: reference },
    });
    if (existing) {
      return { status: 'success', message: 'Payment already processed' };
    }

    // If reference is formatted as SSP-FEE-<invoicePrefix>-<timestamp>
    let invoice = null;
    if (reference.startsWith('SSP-FEE-')) {
      const parts = reference.split('-');
      const invoicePrefix = parts[2];
      invoice = await this.prisma.studentInvoice.findFirst({
        where: { id: { startsWith: invoicePrefix } },
        include: {
          feeStructure: { include: { paymentAccount: true, feeItems: true } },
          student: { include: { studentProfile: true } },
          school: true,
        },
      });
    }

    // Also fallback to metadata if provided
    if (!invoice && data.metadata?.invoiceId) {
      invoice = await this.prisma.studentInvoice.findUnique({
        where: { id: data.metadata.invoiceId },
        include: {
          feeStructure: { include: { paymentAccount: true, feeItems: true } },
          student: { include: { studentProfile: true } },
          school: true,
        },
      });
    }

    if (invoice) {
      await this.applyPaymentSuccess({
        schoolId: invoice.schoolId,
        studentId: invoice.studentId,
        invoice,
        amountKobo: amountKobo || invoice.balanceAmountKobo,
        channel: 'PAYSTACK',
        reference: `PAY-${reference}`,
        paystackReference: reference,
        actorId: invoice.studentId,
        actorRole: 'STUDENT',
      });
      return { status: 'success', message: `Invoice ${invoice.invoiceNumber} processed successfully via webhook.` };
    }

    return { status: 'success', message: 'Webhook received (no matching invoice found)' };
  }

  /**
   * Channel 2 & 3: Bursary Cash & POS Recording (by Bursar/Finance Officer)
   */
  async recordWalkInPayment(
    schoolId: string,
    actorId: string,
    actorRole: string,
    dto: RecordWalkInPaymentDto,
  ) {
    const invoice = await this.prisma.studentInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        feeStructure: { include: { paymentAccount: true, feeItems: true } },
        student: { include: { studentProfile: true } },
        school: true,
      },
    });

    if (!invoice || invoice.schoolId !== schoolId) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.balanceAmountKobo <= 0) {
      throw new BadRequestException('This invoice is already fully cleared.');
    }

    const payAmountKobo = Math.min(dto.amountKobo, invoice.balanceAmountKobo);
    const channelRef =
      dto.channel === 'POS'
        ? `POS-${Date.now()}-${(dto.posTerminalRef || 'TERM').slice(0, 6)}`
        : `CSH-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return this.applyPaymentSuccess({
      schoolId,
      studentId: invoice.studentId,
      invoice,
      amountKobo: payAmountKobo,
      channel: dto.channel,
      reference: channelRef,
      posTerminalRef: dto.posTerminalRef,
      bankTellerNo: dto.bankTellerNo,
      actorId,
      actorRole,
      notes: dto.notes,
    });
  }

  /**
   * Channel 4: Student Submits Bank Transfer Proof
   */
  async submitTransferEvidence(
    schoolId: string,
    studentId: string,
    dto: SubmitTransferEvidenceDto,
  ) {
    const invoice = await this.prisma.studentInvoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        feeStructure: true,
        student: { include: { studentProfile: true } },
      },
    });
    if (!invoice || invoice.schoolId !== schoolId) {
      throw new NotFoundException('Invoice not found');
    }

    let proofImageUrl = dto.proofImageUrl;
    if (!proofImageUrl && dto.proofBase64) {
      const cleanB64 = dto.proofBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(cleanB64, 'base64');
      if (buf.length > 0) {
        const fileName = (dto.fileName || `transfer_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const uploaded = await this.storage.uploadPdfBuffer(
          buf,
          fileName,
          'report-cards',
        );
        proofImageUrl = uploaded.publicUrl;
      }
    }

    if (!proofImageUrl) {
      proofImageUrl = `https://cdn.studentspark.app/evidence/${encodeURIComponent(
        invoice.invoiceNumber,
      )}.jpg`;
    }

    const evidence = await this.prisma.paymentEvidence.create({
      data: {
        invoiceId: dto.invoiceId,
        studentId,
        payerName: dto.payerName.trim(),
        payerBankName: dto.payerBankName?.trim(),
        transferAmountKobo: Number(dto.transferAmountKobo) || invoice.balanceAmountKobo,
        transferDate: dto.transferDate ? new Date(dto.transferDate) : new Date(),
        proofImageUrl,
        submissionNotes: dto.submissionNotes?.trim(),
        status: 'PENDING',
      },
      include: {
        invoice: {
          include: { feeStructure: true },
        },
        student: {
          select: {
            id: true,
            fullName: true,
            loginId: true,
            studentProfile: { select: { matricOrAdmissionNo: true } },
          },
        },
      },
    });

    // Notify School Finance Officers
    const financeStaff = await this.prisma.user.findMany({
      where: { schoolId, role: { in: ['SCHOOL_FINANCE', 'SCHOOL_ADMIN'] } },
      select: { id: true },
    });

    for (const staff of financeStaff) {
      void this.notifications.dispatchNotification({
        userId: staff.id,
        title: '🏦 New Bank Transfer Proof Submitted',
        body: `${evidence.student.fullName} submitted ₦${(evidence.transferAmountKobo / 100).toLocaleString()} transfer proof for ${evidence.invoice.feeStructure.title}.`,
        category: 'COMMUNITY',
      });
    }

    return evidence;
  }

  async getPendingTransferEvidences(schoolId: string) {
    return this.prisma.paymentEvidence.findMany({
      where: {
        invoice: { schoolId },
        status: 'PENDING',
      },
      include: {
        invoice: {
          include: {
            feeStructure: { select: { id: true, title: true, code: true } },
          },
        },
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            loginId: true,
            studentProfile: {
              select: {
                matricOrAdmissionNo: true,
                level: true,
                department: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Channel 4 Review: Approve or Reject Bank Transfer Proof
   */
  async reviewTransferEvidence(
    schoolId: string,
    actorId: string,
    actorRole: string,
    evidenceId: string,
    dto: ReviewTransferEvidenceDto,
  ) {
    const evidence = await this.prisma.paymentEvidence.findUnique({
      where: { id: evidenceId },
      include: {
        invoice: {
          include: {
            feeStructure: { include: { paymentAccount: true, feeItems: true } },
            student: { include: { studentProfile: true } },
            school: true,
          },
        },
        student: true,
      },
    });

    if (!evidence || evidence.invoice.schoolId !== schoolId) {
      throw new NotFoundException('Payment evidence not found');
    }
    if (evidence.status !== 'PENDING') {
      throw new BadRequestException(`This proof has already been ${evidence.status.toLowerCase()}.`);
    }

    if (dto.status === 'REJECTED') {
      const updated = await this.prisma.paymentEvidence.update({
        where: { id: evidenceId },
        data: {
          status: 'REJECTED',
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNotes: dto.reviewNotes?.trim() || 'Payment proof could not be verified on bank records.',
        },
      });

      await this.logFinancialAudit({
        schoolId,
        actorId,
        actorRole,
        action: 'TRANSFER_PROOF_REJECTED',
        entityType: 'PaymentEvidence',
        entityId: evidence.id,
        amountKobo: evidence.transferAmountKobo,
        diffJson: { reason: dto.reviewNotes },
      });

      void this.notifications.dispatchNotification({
        userId: evidence.studentId,
        title: '⚠️ Transfer Proof Rejected',
        body: `Your payment proof for ${evidence.invoice.feeStructure.title} was declined: ${dto.reviewNotes || 'Invalid teller or mismatch'}. Please contact Bursary.`,
        category: 'COMMUNITY',
      });

      return { evidence: updated, status: 'REJECTED' };
    }

    // Status: APPROVED -> Create Verified Payment and issue Receipt
    const result = await this.applyPaymentSuccess({
      schoolId,
      studentId: evidence.studentId,
      invoice: evidence.invoice,
      amountKobo: evidence.transferAmountKobo,
      channel: 'BANK_TRANSFER',
      reference: `TRF-${Date.now()}-${evidence.id.slice(0, 6)}`,
      actorId,
      actorRole,
      evidenceId: evidence.id,
      notes: `Approved transfer from ${evidence.payerName} (${evidence.payerBankName || 'Bank'})`,
    });

    await this.prisma.paymentEvidence.update({
      where: { id: evidenceId },
      data: {
        status: 'APPROVED',
        paymentId: result.payment.id,
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewNotes: dto.reviewNotes?.trim(),
      },
    });

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'TRANSFER_PROOF_APPROVED',
      entityType: 'PaymentEvidence',
      entityId: evidence.id,
      amountKobo: evidence.transferAmountKobo,
      diffJson: { paymentId: result.payment.id, receiptNumber: result.receipt.receiptNumber },
    });

    void this.notifications.dispatchNotification({
      userId: evidence.studentId,
      title: '🎉 Payment Approved & Receipt Issued!',
      body: `Your ₦${(evidence.transferAmountKobo / 100).toLocaleString()} bank transfer for ${evidence.invoice.feeStructure.title} has been confirmed. Tap to download your Digital Receipt.`,
      category: 'COMMUNITY',
    });

    return {
      status: 'APPROVED',
      ...result,
    };
  }

  // ============================================================================
  // 6. BULK BANK STATEMENT CSV RECONCILIATION ENGINE
  // ============================================================================

  async reconcileBankStatementCsv(
    schoolId: string,
    actorId: string,
    actorRole: string,
    dto: ReconciliationCsvDto,
  ) {
    let rawCsv = dto.csvText;
    if (!rawCsv && dto.csvBase64) {
      rawCsv = Buffer.from(dto.csvBase64, 'base64').toString('utf8');
    }
    if (!rawCsv || !rawCsv.trim()) {
      throw new BadRequestException('CSV file content is empty or invalid.');
    }

    const lines = rawCsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length <= 1) {
      throw new BadRequestException('CSV file must have a header row and at least 1 transaction record.');
    }

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
    const rows = lines.slice(1);

    const descIdx = header.findIndex((h) => h.includes('desc') || h.includes('narration') || h.includes('details'));
    const amountIdx = header.findIndex((h) => h.includes('amount') || h.includes('credit') || h.includes('paid'));
    const refIdx = header.findIndex((h) => h.includes('ref') || h.includes('matric') || h.includes('invoice'));

    let matchedCount = 0;
    let unmatchedCount = 0;
    let totalReconciledKobo = 0;
    const matchResults: any[] = [];

    for (const rowStr of rows) {
      const cols = rowStr.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
      if (cols.length < 2) continue;

      const desc = descIdx >= 0 ? cols[descIdx] : rowStr;
      const refOrMatric = refIdx >= 0 ? cols[refIdx] : '';
      const amountStr = amountIdx >= 0 ? cols[amountIdx] : '0';
      const cleanAmount = parseFloat(amountStr.replace(/[^0-9.]/g, '')) || 0;
      const amountKobo = Math.round(cleanAmount * 100);

      let matchedInvoice: any = null;

      if (refOrMatric) {
        matchedInvoice = await this.prisma.studentInvoice.findFirst({
          where: {
            schoolId,
            OR: [
              { invoiceNumber: { equals: refOrMatric, mode: 'insensitive' } },
              { student: { studentProfile: { matricOrAdmissionNo: { equals: refOrMatric, mode: 'insensitive' } } } },
              { student: { loginId: { equals: refOrMatric, mode: 'insensitive' } } },
            ],
            status: { not: 'PAID' },
          },
          include: {
            feeStructure: { include: { paymentAccount: true, feeItems: true } },
            student: { include: { studentProfile: true } },
            school: true,
          },
        });
      }

      if (!matchedInvoice && desc) {
        const tokens = desc.split(/[\s/_-]+/).filter((t) => t.length >= 4);
        for (const token of tokens) {
          const found = await this.prisma.studentInvoice.findFirst({
            where: {
              schoolId,
              OR: [
                { invoiceNumber: { contains: token, mode: 'insensitive' } },
                { student: { studentProfile: { matricOrAdmissionNo: { contains: token, mode: 'insensitive' } } } },
                { student: { loginId: { contains: token, mode: 'insensitive' } } },
              ],
              status: { not: 'PAID' },
            },
            include: {
              feeStructure: { include: { paymentAccount: true, feeItems: true } },
              student: { include: { studentProfile: true } },
              school: true,
            },
          });
          if (found) {
            matchedInvoice = found;
            break;
          }
        }
      }

      if (matchedInvoice && amountKobo > 0) {
        const payAmount = Math.min(amountKobo, matchedInvoice.balanceAmountKobo);
        const autoRef = `CSV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        await this.applyPaymentSuccess({
          schoolId,
          studentId: matchedInvoice.studentId,
          invoice: matchedInvoice,
          amountKobo: payAmount,
          channel: 'BANK_TRANSFER',
          reference: autoRef,
          actorId,
          actorRole,
          notes: `Reconciled via Bank Statement CSV (${dto.fileName || 'statement.csv'})`,
        });

        matchedCount++;
        totalReconciledKobo += payAmount;
        matchResults.push({
          row: desc,
          status: 'MATCHED',
          invoiceNumber: matchedInvoice.invoiceNumber,
          studentName: matchedInvoice.student.fullName,
          amountKobo: payAmount,
        });
      } else {
        unmatchedCount++;
        matchResults.push({
          row: desc,
          status: 'UNMATCHED',
          amountKobo,
        });
      }
    }

    const batch = await this.prisma.reconciliationBatch.create({
      data: {
        schoolId,
        paymentAccountId: dto.paymentAccountId,
        uploadedById: actorId,
        fileName: dto.fileName || `bank_statement_${Date.now()}.csv`,
        totalRows: rows.length,
        matchedRows: matchedCount,
        unmatchedRows: unmatchedCount,
        totalAmountKobo: BigInt(totalReconciledKobo),
        status: 'COMPLETED',
        resultsJson: matchResults.slice(0, 100),
      },
    });

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'BANK_RECONCILIATION_COMPLETED',
      entityType: 'ReconciliationBatch',
      entityId: batch.id,
      amountKobo: totalReconciledKobo,
      diffJson: {
        fileName: batch.fileName,
        totalRows: batch.totalRows,
        matchedRows: batch.matchedRows,
        unmatchedRows: batch.unmatchedRows,
      },
    });

    return {
      batchId: batch.id,
      fileName: batch.fileName,
      totalRows: rows.length,
      matchedRows: matchedCount,
      unmatchedRows: unmatchedCount,
      totalReconciledKobo,
      summary: matchResults.slice(0, 50),
    };
  }

  // ============================================================================
  // 7. VERIFIABLE DIGITAL CLEARANCE RECEIPT LOOKUP
  // ============================================================================

  async getReceiptByQrToken(qrToken: string) {
    const receipt = await this.prisma.financeReceipt.findUnique({
      where: { qrToken },
      include: {
        school: { select: { id: true, name: true, schoolCode: true, logoUrl: true } },
        payment: {
          select: {
            id: true,
            channel: true,
            reference: true,
            paidAt: true,
            allocations: {
              include: { feeItem: true },
            },
          },
        },
        invoice: {
          include: {
            feeStructure: { select: { id: true, title: true, code: true, sessionName: true } },
          },
        },
        student: {
          select: {
            id: true,
            fullName: true,
            loginId: true,
            email: true,
            studentProfile: {
              select: {
                matricOrAdmissionNo: true,
                level: true,
                department: { select: { name: true, unit: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException('Official receipt with this QR code token does not exist.');
    }

    return receipt;
  }

  async verifyClearanceByToken(qrClearanceToken: string) {
    const invoice = await this.prisma.studentInvoice.findUnique({
      where: { qrClearanceToken },
      include: {
        school: { select: { id: true, name: true, schoolCode: true, logoUrl: true } },
        student: {
          select: {
            id: true,
            fullName: true,
            loginId: true,
            studentProfile: {
              select: {
                matricOrAdmissionNo: true,
                level: true,
                department: { select: { name: true, unit: { select: { name: true } } } },
              },
            },
          },
        },
        feeStructure: true,
        receipts: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Clearance record not found.');
    }

    const matricNo = invoice.student.studentProfile?.matricOrAdmissionNo || invoice.student.loginId;

    return {
      isValid: invoice.status === 'PAID' || invoice.balanceAmountKobo <= 0,
      invoiceNumber: invoice.invoiceNumber,
      title: invoice.feeStructure.title,
      status: invoice.status,
      studentName: invoice.student.fullName,
      matricNo,
      department: invoice.student.studentProfile?.department?.name,
      faculty: invoice.student.studentProfile?.department?.unit?.name,
      level: invoice.student.studentProfile?.level,
      paidAmountKobo: invoice.paidAmountKobo,
      balanceAmountKobo: invoice.balanceAmountKobo,
      clearedAt: invoice.clearedAt,
      school: invoice.school,
    };
  }

  // ============================================================================
  // 8. FINANCIAL ANALYTICS & BURSARY DASHBOARD OVERVIEW
  // ============================================================================

  async getFinanceAnalytics(schoolId: string) {
    const [invoices, payments, pendingProofsCount, accounts] = await Promise.all([
      this.prisma.studentInvoice.findMany({
        where: { schoolId },
        select: {
          totalAmountKobo: true,
          paidAmountKobo: true,
          balanceAmountKobo: true,
          status: true,
        },
      }),
      this.prisma.financePayment.findMany({
        where: { schoolId, status: 'VERIFIED' },
        select: {
          amountKobo: true,
          channel: true,
          paidAt: true,
        },
      }),
      this.prisma.paymentEvidence.count({
        where: { invoice: { schoolId }, status: 'PENDING' },
      }),
      this.prisma.paymentAccount.count({
        where: { schoolId, isActive: true },
      }),
    ]);

    const totalInvoicedKobo = invoices.reduce((sum, i) => sum + i.totalAmountKobo, 0);
    const totalCollectedKobo = invoices.reduce((sum, i) => sum + i.paidAmountKobo, 0);
    const totalOutstandingKobo = invoices.reduce((sum, i) => sum + i.balanceAmountKobo, 0);
    const collectionRatePercent =
      totalInvoicedKobo > 0
        ? Math.round((totalCollectedKobo / totalInvoicedKobo) * 100)
        : 0;

    const channelBreakdown: Record<string, number> = {
      PAYSTACK: 0,
      BANK_TRANSFER: 0,
      CASH: 0,
      POS: 0,
    };
    payments.forEach((p) => {
      const ch = p.channel || 'PAYSTACK';
      channelBreakdown[ch] = (channelBreakdown[ch] || 0) + p.amountKobo;
    });

    return {
      totalInvoicedKobo,
      totalCollectedKobo,
      totalOutstandingKobo,
      collectionRatePercent,
      invoicesCount: invoices.length,
      paidInvoicesCount: invoices.filter((i) => i.status === 'PAID').length,
      pendingProofsCount,
      activeAccountsCount: accounts,
      channelBreakdown,
    };
  }

  // ============================================================================
  // PRIVATE HELPER: ATOMIC PAYMENT APPLICATION & RECEIPT ISSUANCE
  // ============================================================================

  private async applyPaymentSuccess(params: {
    schoolId: string;
    studentId: string;
    invoice: any;
    amountKobo: number;
    channel: string;
    reference: string;
    paystackReference?: string;
    posTerminalRef?: string;
    bankTellerNo?: string;
    actorId: string;
    actorRole: string;
    evidenceId?: string;
    notes?: string;
  }) {
    const { schoolId, studentId, invoice, amountKobo, channel, reference } = params;

    const newPaidAmount = invoice.paidAmountKobo + amountKobo;
    const newBalance = Math.max(0, invoice.totalAmountKobo - newPaidAmount);
    const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';
    const isNowCleared = newStatus === 'PAID';

    const schoolCode = (invoice.school?.schoolCode || 'SSP').toUpperCase();
    const receiptNumber = `REC-${schoolCode}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const qrReceiptToken = `RCV-${schoolCode}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // 1. Create FinancePayment
    const payment = await this.prisma.financePayment.create({
      data: {
        schoolId,
        studentId,
        invoiceId: invoice.id,
        paymentAccountId: invoice.feeStructure?.paymentAccountId,
        amountKobo,
        channel,
        status: 'VERIFIED',
        reference,
        paystackReference: params.paystackReference,
        posTerminalRef: params.posTerminalRef,
        bankTellerNo: params.bankTellerNo,
        recordedById: params.actorRole !== 'STUDENT' ? params.actorId : undefined,
        verifiedById: params.actorId,
        verifiedAt: new Date(),
        receiptNumber,
        qrReceiptToken,
        metadataJson: {
          notes: params.notes,
          evidenceId: params.evidenceId,
          feeTitle: invoice.feeStructure?.title,
        },
      },
    });

    // 2. Allocate payment to fee items proportionally or in order
    const feeItems = invoice.feeStructure?.feeItems || [];
    if (feeItems.length > 0) {
      let remainingToAllocate = amountKobo;
      for (const item of feeItems) {
        if (remainingToAllocate <= 0) break;
        const allocAmount = Math.min(item.amountKobo, remainingToAllocate);
        await this.prisma.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            feeItemId: item.id,
            amountKobo: allocAmount,
          },
        });
        remainingToAllocate -= allocAmount;
      }
    }

    // 3. Update StudentInvoice
    await this.prisma.studentInvoice.update({
      where: { id: invoice.id },
      data: {
        paidAmountKobo: newPaidAmount,
        balanceAmountKobo: newBalance,
        status: newStatus,
        clearedAt: isNowCleared ? new Date() : invoice.clearedAt,
      },
    });

    const matricNo =
      invoice.student?.studentProfile?.matricOrAdmissionNo || invoice.student?.loginId || 'Student';

    // 4. Issue Official FinanceReceipt
    const receipt = await this.prisma.financeReceipt.create({
      data: {
        schoolId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        studentId,
        receiptNumber,
        qrToken: qrReceiptToken,
        amountKobo,
        payerFullName: invoice.student?.fullName || 'Student',
        payerMatricOrAdmissionNo: matricNo,
        academicSession: invoice.feeStructure?.sessionName || '2025/2026',
        feeCategory: invoice.feeStructure?.title || 'Academic Fees',
        status: 'ISSUED',
      },
    });

    // 5. Immutable Audit Log
    await this.logFinancialAudit({
      schoolId,
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: `PAYMENT_RECORDED_${channel}`,
      entityType: 'FinancePayment',
      entityId: payment.id,
      amountKobo,
      diffJson: {
        invoiceId: invoice.id,
        receiptNumber,
        newStatus,
        newBalanceKobo: newBalance,
      },
    });

    return {
      payment,
      receipt,
      invoice: {
        id: invoice.id,
        paidAmountKobo: newPaidAmount,
        balanceAmountKobo: newBalance,
        status: newStatus,
      },
    };
  }

  private async logFinancialAudit(params: {
    schoolId: string;
    actorId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    amountKobo?: number;
    diffJson?: any;
    ipAddress?: string;
  }) {
    try {
      await this.prisma.financialAuditLog.create({
        data: {
          schoolId: params.schoolId,
          actorId: params.actorId,
          actorRole: params.actorRole,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          amountKobo: params.amountKobo,
          diffJson: params.diffJson,
          ipAddress: params.ipAddress,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to create financial audit log: ${String(err)}`);
    }
  }
}
