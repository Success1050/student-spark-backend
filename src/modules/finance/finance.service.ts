import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
import { FinanceGateway } from './finance.gateway.js';
import {
  CreateFeeStructureDto,
  UpdateFeeStructureDto,
  CreatePaymentAccountDto,
  UpdatePaymentAccountDto,
  ApproveFeeStructureDto,
  RejectFeeStructureDto,
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
  private readonly pendingInvoiceSyncs = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly financeGateway?: FinanceGateway,
  ) {}

  // ============================================================================
  // 1. PAYMENT ACCOUNTS (INSTITUTION & FACULTY BANK ACCOUNTS)
  // ============================================================================

  /**
   * Automatically provisions or retrieves an active Paystack subaccount for a school bank account.
   * Eliminates manual subaccount code entry by calling Paystack's API behind the scenes.
   */
  private async autoProvisionPaystackSubaccount(
    businessName: string,
    settlementBankCode: string,
    accountNumber: string,
    description?: string,
  ): Promise<string | null> {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret || secret.includes('placeholder')) {
      return null;
    }

    const cleanBank = settlementBankCode.trim();
    const cleanAcc = accountNumber.trim();
    const cleanName = businessName.trim() || 'Institution Collection Account';

    try {
      // 1. Check if a subaccount already exists on Paystack for this account number
      const listRes = await fetch('https://api.paystack.co/subaccount?perPage=100', {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(6000),
      });
      const listData = (await listRes.json()) as any;
      if (listData?.status && Array.isArray(listData.data)) {
        // Paystack returns settlement_bank as a bank NAME (e.g. "Moniepoint MFB"), not a code,
        // so match on the 10-digit NUBAN (unique enough in practice) + active status.
        const existing = listData.data.find(
          (sub: any) => String(sub.account_number) === cleanAcc && !!sub.active,
        );
        if (existing?.subaccount_code) {
          this.logger.log(
            `Found existing active Paystack subaccount ${existing.subaccount_code} for ${cleanAcc}`,
          );
          return existing.subaccount_code;
        }
      }

      // 2. Provision new subaccount on Paystack
      const createRes = await fetch('https://api.paystack.co/subaccount', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          business_name: cleanName,
          settlement_bank: cleanBank,
          account_number: cleanAcc,
          // Platform (main account) share of each payment. Mirrors the "Your share of payment (%)"
          // field on the Paystack dashboard. Configurable via env; can still be edited per school on Paystack.
          percentage_charge: Math.min(
            100,
            Math.max(0, Number(process.env.PAYSTACK_SCHOOL_SPLIT_PERCENT ?? 0) || 0),
          ),
          description: description || cleanName,
        }),
        signal: AbortSignal.timeout(8000),
      });

      const createData = (await createRes.json()) as any;
      if (createData?.status && createData?.data?.subaccount_code) {
        this.logger.log(
          `Successfully auto-provisioned Paystack subaccount ${createData.data.subaccount_code} for ${cleanAcc}`,
        );
        return createData.data.subaccount_code;
      } else {
        this.logger.warn(
          `Paystack subaccount auto-provision notice: ${createData?.message || 'Could not provision'}. Proceeding without subaccount.`,
        );
        return null;
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to auto-provision Paystack subaccount: ${err?.message || err}. Safe fallback active.`,
      );
      return null;
    }
  }

  /**
   * Option B monetisation: flat platform convenience fee (kobo) added ON TOP of the school fee.
   * The school's subaccount receives exactly the invoice amount; the platform keeps this fee.
   * Configure via PLATFORM_CONVENIENCE_FEE_KOBO (e.g. 30000 = ₦300). 0 disables it.
   */
  getPlatformFeeKobo(): number {
    const raw = Number(process.env.PLATFORM_CONVENIENCE_FEE_KOBO ?? 0);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  }

  /**
   * Converts a verified Paystack amount into the portion that should be credited to the invoice.
   * Uses `requested_amount` (excludes Paystack fees passed to the customer) and strips the platform fee.
   */
  private extractSchoolPrincipalKobo(paystackData: any): number {
    const base = Number(paystackData?.requested_amount) || Number(paystackData?.amount) || 0;
    const metaFee = Number(paystackData?.metadata?.platformFeeKobo) || 0;
    // Use the larger of configured vs recorded fee so a tampered metadata value can never over-credit.
    const fee = Math.max(this.getPlatformFeeKobo(), metaFee);
    return base > fee ? base - fee : base;
  }

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

    let subaccountCode = dto.paystackSubaccountCode?.trim() || null;

    // Auto-provision Paystack subaccount if not provided, using verified bankCode & NUBAN
    if (!subaccountCode && dto.bankCode && dto.accountNumber) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      });
      subaccountCode = await this.autoProvisionPaystackSubaccount(
        dto.accountName.trim(),
        dto.bankCode.trim(),
        dto.accountNumber.trim(),
        `${school?.name || 'School'} ${dto.accountType || 'Central Bursary'}`,
      );
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
        paystackSubaccountCode: subaccountCode,
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
        paystackSubaccountCode: account.paystackSubaccountCode,
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

    let subaccountCode =
      dto.paystackSubaccountCode !== undefined
        ? dto.paystackSubaccountCode?.trim() || null
        : account.paystackSubaccountCode;

    const targetBankCode = dto.bankCode !== undefined ? dto.bankCode?.trim() : account.bankCode;
    const targetAccNumber =
      dto.accountNumber !== undefined ? dto.accountNumber.trim() : account.accountNumber;
    const targetAccName =
      dto.accountName !== undefined ? dto.accountName.trim() : account.accountName;

    // If bank details changed or no subaccount exists yet, auto-provision
    const bankChanged =
      (dto.bankCode && dto.bankCode.trim() !== account.bankCode) ||
      (dto.accountNumber && dto.accountNumber.trim() !== account.accountNumber);

    if ((!subaccountCode || bankChanged) && targetBankCode && targetAccNumber) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      });
      const autoCode = await this.autoProvisionPaystackSubaccount(
        targetAccName,
        targetBankCode,
        targetAccNumber,
        `${school?.name || 'School'} ${dto.accountType || account.accountType}`,
      );
      if (autoCode) {
        subaccountCode = autoCode;
      }
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
        paystackSubaccountCode: subaccountCode,
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
          paystackSubaccountCode: account.paystackSubaccountCode,
        },
        current: {
          bankName: updated.bankName,
          accountNumber: updated.accountNumber,
          accountName: updated.accountName,
          paystackSubaccountCode: updated.paystackSubaccountCode,
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

  async getFinanceConfigOptions(schoolId: string) {
    const [school, classes, sessions, units, departments] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: {
          id: true,
          name: true,
          schoolCode: true,
          institutionType: true,
        },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        select: {
          id: true,
          name: true,
          levelCode: true,
          termOrSemester: true,
          departmentId: true,
          department: { select: { id: true, name: true, code: true } },
          _count: {
            select: {
              studentProfiles: true,
              students: true,
              enrollments: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.academicSession.findMany({
        where: { schoolId },
        include: {
          terms: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.academicUnit.findMany({
        where: { schoolId },
        select: { id: true, name: true, code: true, unitType: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { schoolId },
        select: { id: true, name: true, code: true, unitId: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const instUpper = String(school?.institutionType || '').toUpperCase();
    const isTertiary = ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE_OF_EDUCATION', 'TERTIARY'].includes(
      instUpper,
    );

    const allSchoolInvoices = await this.prisma.studentInvoice.findMany({
      where: { schoolId },
      select: {
        paidAmountKobo: true,
        balanceAmountKobo: true,
        status: true,
        student: {
          select: {
            classId: true,
            studentProfile: { select: { classId: true } },
          },
        },
        feeStructure: { select: { classId: true } },
      },
    });

    const classStatsMap = new Map<
      string,
      { paidCount: number; halfPaidCount: number; unpaidCount: number; totalCount: number }
    >();
    for (const inv of allSchoolInvoices) {
      const cid =
        inv.student?.studentProfile?.classId ||
        inv.student?.classId ||
        inv.feeStructure?.classId ||
        null;
      if (!cid) continue;
      const stats = classStatsMap.get(cid) || {
        paidCount: 0,
        halfPaidCount: 0,
        unpaidCount: 0,
        totalCount: 0,
      };
      stats.totalCount += 1;
      if (inv.status === 'PAID' || inv.balanceAmountKobo <= 0) {
        stats.paidCount += 1;
      } else if (inv.paidAmountKobo > 0 && inv.balanceAmountKobo > 0) {
        stats.halfPaidCount += 1;
      } else {
        stats.unpaidCount += 1;
      }
      classStatsMap.set(cid, stats);
    }

    const enrichedClasses = classes.map((cls) => ({
      ...cls,
      invoiceStats: classStatsMap.get(cls.id) || {
        paidCount: 0,
        halfPaidCount: 0,
        unpaidCount: 0,
        totalCount: 0,
      },
    }));

    return {
      school: school ? { ...school, isTertiary } : null,
      classes: enrichedClasses,
      sessions,
      units,
      departments,
    };
  }

  async getFeeStructures(
    schoolId: string,
    filters?: {
      targetScope?: string;
      unitId?: string;
      departmentId?: string;
      classId?: string;
      termId?: string;
      levelName?: string;
      approvalStatus?: string;
      onlyPublished?: boolean;
    },
  ) {
    return this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        ...(filters?.targetScope ? { targetScope: filters.targetScope } : {}),
        ...(filters?.unitId ? { unitId: filters.unitId } : {}),
        ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters?.classId ? { classId: filters.classId } : {}),
        ...(filters?.termId ? { termId: filters.termId } : {}),
        ...(filters?.levelName ? { levelName: filters.levelName } : {}),
        ...(filters?.approvalStatus ? { approvalStatus: filters.approvalStatus } : {}),
        ...(filters?.onlyPublished ? { isPublished: true, approvalStatus: 'APPROVED' } : {}),
      },
      include: {
        feeItems: { orderBy: { sortOrder: 'asc' } },
        paymentAccount: true,
        unit: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        class: { select: { id: true, name: true, levelCode: true } },
        term: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true, role: true } },
        approvedBy: { select: { id: true, fullName: true, role: true } },
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

    let paymentAccountId = dto.paymentAccountId?.trim() || undefined;
    if (!paymentAccountId) {
      const defaultAcc = await this.prisma.paymentAccount.findFirst({
        where: { schoolId, isDefault: true, isActive: true },
      });
      paymentAccountId = defaultAcc?.id;
    }

    const isBursar = actorRole === 'SCHOOL_FINANCE';
    const approvalStatus = isBursar ? 'PENDING_APPROVAL' : 'APPROVED';
    const isPublished = !isBursar;
    const approvedById = isBursar ? null : actorId;
    const approvedAt = isBursar ? null : new Date();

    const billingPeriod =
      dto.billingPeriod ||
      (dto.termOrSemester?.toUpperCase().includes('TERM') ? 'PER_TERM' : 'PER_SESSION');

    // Enforce current active term only: fees cannot be created for previous or future terms
    const activeTerm = await this.prisma.academicTerm.findFirst({
      where: { isCurrent: true, session: { schoolId } },
      include: { session: true },
    });
    if (activeTerm && dto.termId?.trim() && dto.termId.trim() !== activeTerm.id) {
      throw new BadRequestException(
        'Fees can only be created for the current active term. Creating fees for previous or future terms is not allowed.',
      );
    }

    const effectiveTermId = activeTerm?.id || dto.termId?.trim() || null;
    const effectiveTermName = activeTerm?.name || dto.termOrSemester?.trim() || null;
    const effectiveSessionName =
      activeTerm?.session?.name || dto.sessionName?.trim() || '2025/2026';

    const targetScope = dto.targetScope || 'WHOLE_SCHOOL';

    const rawClassIds =
      Array.isArray(dto.classIds) && dto.classIds.length > 0
        ? Array.from(new Set(dto.classIds.map((id) => id?.trim()).filter(Boolean) as string[]))
        : dto.classId?.trim()
          ? [dto.classId.trim()]
          : [];

    const includeRelations = {
      feeItems: { orderBy: { sortOrder: 'asc' as const } },
      paymentAccount: true,
      unit: { select: { id: true, name: true, code: true } },
      department: { select: { id: true, name: true, code: true } },
      class: { select: { id: true, name: true, levelCode: true } },
      term: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true, role: true } },
      approvedBy: { select: { id: true, fullName: true, role: true } },
      _count: { select: { invoices: true } },
    };

    if (targetScope === 'LEVEL_OR_CLASS' && rawClassIds.length > 1) {
      const selectedClasses = await this.prisma.schoolClass.findMany({
        where: { schoolId, id: { in: rawClassIds } },
        orderBy: { name: 'asc' },
      });
      if (selectedClasses.length === 0) {
        throw new BadRequestException('Selected classes were not found in this institution.');
      }

      const createdStructures: any[] = [];
      let totalGeneratedInvoicesCount = 0;

      for (const cls of selectedClasses) {
        const classTitle = dto.title.toLowerCase().includes(cls.name.toLowerCase())
          ? dto.title.trim()
          : `${dto.title.trim()} (${cls.name})`;
        const classCodeSuffix =
          cls.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || cls.id.slice(0, 4).toUpperCase();
        const classCode = `${dto.code.trim().toUpperCase()}-${classCodeSuffix}`;

        const created = await this.prisma.feeStructure.create({
          data: {
            schoolId,
            title: classTitle,
            code: classCode,
            sessionName: effectiveSessionName,
            termId: effectiveTermId,
            termOrSemester: effectiveTermName,
            targetScope,
            unitId: null,
            departmentId: null,
            classId: cls.id,
            levelName: dto.levelName?.trim() || null,
            paymentAccountId: paymentAccountId || null,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            isMandatory: dto.isMandatory ?? true,
            allowPartialPayment: dto.allowPartialPayment ?? true,
            minimumPartialKobo: dto.minimumPartialKobo ?? 0,
            totalAmountKobo: totalKobo,
            isPublished,
            approvalStatus,
            approvedById,
            approvedAt,
            billingPeriod,
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
          include: includeRelations,
        });

        let invCount = 0;
        if (isPublished && dto.autoGenerateInvoices !== false) {
          invCount = await this.generateInvoicesForFeeStructure(schoolId, created.id);
          totalGeneratedInvoicesCount += invCount;
        }

        await this.logFinancialAudit({
          schoolId,
          actorId,
          actorRole,
          action: 'FEE_STRUCTURE_CREATED',
          entityType: 'FeeStructure',
          entityId: created.id,
          amountKobo: totalKobo,
          diffJson: {
            title: created.title,
            code: created.code,
            targetScope: created.targetScope,
            classId: created.classId,
            termId: created.termId,
            billingPeriod,
            approvalStatus,
            generatedInvoicesCount: invCount,
          },
        });

        createdStructures.push(created);
      }

      return {
        ...createdStructures[0],
        createdStructuresCount: createdStructures.length,
        createdStructures,
        generatedInvoicesCount: totalGeneratedInvoicesCount,
      };
    }

    const singleClassId = rawClassIds[0] || dto.classId?.trim() || null;

    const feeStructure = await this.prisma.feeStructure.create({
      data: {
        schoolId,
        title: dto.title.trim(),
        code: dto.code.trim().toUpperCase(),
        sessionName: effectiveSessionName,
        termId: effectiveTermId,
        termOrSemester: effectiveTermName,
        targetScope,
        unitId: dto.unitId?.trim() || null,
        departmentId: dto.departmentId?.trim() || null,
        classId: singleClassId,
        levelName: dto.levelName?.trim() || null,
        paymentAccountId: paymentAccountId || null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        isMandatory: dto.isMandatory ?? true,
        allowPartialPayment: dto.allowPartialPayment ?? true,
        minimumPartialKobo: dto.minimumPartialKobo ?? 0,
        totalAmountKobo: totalKobo,
        isPublished,
        approvalStatus,
        approvedById,
        approvedAt,
        billingPeriod,
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
      include: includeRelations,
    });

    let generatedInvoicesCount = 0;
    // Only auto-generate invoices if approved (not pending bursary approval)
    if (isPublished && dto.autoGenerateInvoices !== false) {
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
        classId: feeStructure.classId,
        termId: feeStructure.termId,
        billingPeriod,
        approvalStatus,
        generatedInvoicesCount,
      },
    });

    return {
      ...feeStructure,
      createdStructuresCount: 1,
      generatedInvoicesCount,
    };
  }

  async updateFeeStructure(
    schoolId: string,
    feeStructureId: string,
    actorId: string,
    actorRole: string,
    dto: UpdateFeeStructureDto,
  ) {
    const fee = await this.prisma.feeStructure.findFirst({
      where: { id: feeStructureId, schoolId },
      include: { feeItems: true },
    });
    if (!fee) {
      throw new NotFoundException('Fee structure not found');
    }

    // Strict post-approval lock: once School Admin approves & publishes a fee, Bursar cannot modify it
    if (actorRole === 'SCHOOL_FINANCE' && (fee.approvalStatus === 'APPROVED' || fee.isPublished)) {
      throw new ForbiddenException(
        'This fee structure has already been approved and published by the School Admin and cannot be modified by the Bursar.',
      );
    }

    const hasNewItems = Array.isArray(dto.items) && dto.items.length > 0;
    if (hasNewItems) {
      const existingAllocations = await this.prisma.paymentAllocation.count({
        where: { feeItem: { feeStructureId } },
      });
      if (existingAllocations > 0) {
        throw new BadRequestException(
          'Breakdown items cannot be replaced because verified student payments have already been allocated against this fee structure.',
        );
      }
    }

    const newTotalKobo = hasNewItems
      ? dto.items!.reduce((sum, item) => sum + (Number(item.amountKobo) || 0), 0)
      : fee.totalAmountKobo;

    const isAdminActor = actorRole === 'SCHOOL_ADMIN' || actorRole === 'SUPER_ADMIN';
    let nextApprovalStatus = fee.approvalStatus;
    let nextIsPublished = fee.isPublished;
    let nextApprovedById = fee.approvedById;
    let nextApprovedAt = fee.approvedAt;
    let nextRejectionReason = fee.rejectionReason;

    if (actorRole === 'SCHOOL_FINANCE') {
      nextApprovalStatus = 'PENDING_APPROVAL';
      nextIsPublished = false;
      nextRejectionReason = null;
    } else if (isAdminActor && dto.approveAndPublish) {
      nextApprovalStatus = 'APPROVED';
      nextIsPublished = true;
      nextApprovedById = actorId;
      nextApprovedAt = new Date();
      nextRejectionReason = null;
    }

    const hasClassIdsField = Array.isArray(dto.classIds);
    const rawClassIds = hasClassIdsField
      ? Array.from(new Set(dto.classIds!.map((id) => id?.trim()).filter(Boolean) as string[]))
      : dto.classId?.trim()
        ? [dto.classId.trim()]
        : [];

    const primaryClassId =
      rawClassIds.length > 0
        ? fee.classId && rawClassIds.includes(fee.classId)
          ? fee.classId
          : rawClassIds[0]
        : hasClassIdsField || dto.classId !== undefined
          ? dto.classId?.trim() || null
          : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (hasNewItems) {
        await tx.feeItem.deleteMany({ where: { feeStructureId } });
        await tx.feeItem.createMany({
          data: dto.items!.map((item, idx) => ({
            feeStructureId,
            name: item.name.trim(),
            amountKobo: Number(item.amountKobo) || 0,
            isOptional: item.isOptional ?? false,
            sortOrder: item.sortOrder ?? idx + 1,
          })),
        });
      }

      const saved = await tx.feeStructure.update({
        where: { id: feeStructureId },
        data: {
          title: dto.title !== undefined ? dto.title.trim() : undefined,
          code: dto.code !== undefined ? dto.code.trim().toUpperCase() : undefined,
          sessionName: dto.sessionName !== undefined ? dto.sessionName.trim() : undefined,
          termId: dto.termId !== undefined ? dto.termId?.trim() || null : undefined,
          termOrSemester:
            dto.termOrSemester !== undefined ? dto.termOrSemester?.trim() || null : undefined,
          targetScope: dto.targetScope !== undefined ? dto.targetScope : undefined,
          unitId: dto.unitId !== undefined ? dto.unitId?.trim() || null : undefined,
          departmentId:
            dto.departmentId !== undefined ? dto.departmentId?.trim() || null : undefined,
          classId: primaryClassId,
          levelName: dto.levelName !== undefined ? dto.levelName?.trim() || null : undefined,
          paymentAccountId:
            dto.paymentAccountId !== undefined ? dto.paymentAccountId?.trim() || null : undefined,
          dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
          isMandatory: dto.isMandatory !== undefined ? dto.isMandatory : undefined,
          allowPartialPayment:
            dto.allowPartialPayment !== undefined ? dto.allowPartialPayment : undefined,
          minimumPartialKobo:
            dto.minimumPartialKobo !== undefined ? dto.minimumPartialKobo : undefined,
          billingPeriod: dto.billingPeriod !== undefined ? dto.billingPeriod : undefined,
          totalAmountKobo: newTotalKobo,
          approvalStatus: nextApprovalStatus,
          isPublished: nextIsPublished,
          approvedById: nextApprovedById,
          approvedAt: nextApprovedAt,
          rejectionReason: nextRejectionReason,
        },
        include: {
          feeItems: { orderBy: { sortOrder: 'asc' } },
          paymentAccount: true,
          unit: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true, code: true } },
          class: { select: { id: true, name: true, levelCode: true } },
          term: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true, role: true } },
          approvedBy: { select: { id: true, fullName: true, role: true } },
          _count: { select: { invoices: true } },
        },
      });

      if (nextIsPublished && nextApprovalStatus === 'APPROVED' && newTotalKobo !== fee.totalAmountKobo) {
        await tx.studentInvoice.updateMany({
          where: {
            feeStructureId,
            status: 'UNPAID',
            paidAmountKobo: 0,
          },
          data: {
            totalAmountKobo: newTotalKobo,
            balanceAmountKobo: newTotalKobo,
          },
        });
      }

      return saved;
    });

    let generatedInvoicesCount = 0;
    if (nextIsPublished && nextApprovalStatus === 'APPROVED' && dto.autoGenerateInvoices !== false) {
      generatedInvoicesCount = await this.generateInvoicesForFeeStructure(
        schoolId,
        feeStructureId,
      );
    }

    let stretchedClassesCount = 1;
    const effectiveScope = dto.targetScope || fee.targetScope;
    if (effectiveScope === 'LEVEL_OR_CLASS' && rawClassIds.length > 1) {
      const extraClassIds = rawClassIds.filter((id) => id !== updated.classId);
      if (extraClassIds.length > 0) {
        const extraClasses = await this.prisma.schoolClass.findMany({
          where: { schoolId, id: { in: extraClassIds } },
          orderBy: { name: 'asc' },
        });
        const baseTitle = updated.title.replace(/\s*\([^)]+\)\s*$/, '').trim();
        const baseCode = updated.code;

        for (const cls of extraClasses) {
          const suffix =
            cls.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || cls.id.slice(0, 4).toUpperCase();
          const stretched = await this.prisma.feeStructure.create({
            data: {
              schoolId,
              title: `${baseTitle} (${cls.name})`,
              code: `${baseCode}-${suffix}`,
              sessionName: updated.sessionName,
              termId: updated.termId,
              termOrSemester: updated.termOrSemester,
              targetScope: 'LEVEL_OR_CLASS',
              unitId: null,
              departmentId: null,
              classId: cls.id,
              levelName: updated.levelName,
              paymentAccountId: updated.paymentAccountId,
              dueDate: updated.dueDate,
              isMandatory: updated.isMandatory,
              allowPartialPayment: updated.allowPartialPayment,
              minimumPartialKobo: updated.minimumPartialKobo,
              totalAmountKobo: newTotalKobo,
              isPublished: nextIsPublished,
              approvalStatus: nextApprovalStatus,
              approvedById: nextApprovedById,
              approvedAt: nextApprovedAt,
              billingPeriod: updated.billingPeriod,
              createdById: fee.createdById || actorId,
              feeItems: {
                create: updated.feeItems.map((item, idx) => ({
                  name: item.name,
                  amountKobo: item.amountKobo,
                  isOptional: item.isOptional,
                  sortOrder: item.sortOrder ?? idx + 1,
                })),
              },
            },
          });

          if (
            nextIsPublished &&
            nextApprovalStatus === 'APPROVED' &&
            dto.autoGenerateInvoices !== false
          ) {
            generatedInvoicesCount += await this.generateInvoicesForFeeStructure(
              schoolId,
              stretched.id,
            );
          }

          await this.logFinancialAudit({
            schoolId,
            actorId,
            actorRole,
            action: 'FEE_STRUCTURE_CREATED',
            entityType: 'FeeStructure',
            entityId: stretched.id,
            amountKobo: newTotalKobo,
            diffJson: {
              stretchedFromId: fee.id,
              classId: cls.id,
              approvalStatus: nextApprovalStatus,
            },
          });
        }
        stretchedClassesCount = extraClasses.length + 1;
      }
    }

    const auditAction =
      isAdminActor && dto.approveAndPublish
        ? 'FEE_STRUCTURE_MODIFIED_AND_APPROVED'
        : 'FEE_STRUCTURE_UPDATED';

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: auditAction,
      entityType: 'FeeStructure',
      entityId: fee.id,
      amountKobo: newTotalKobo,
      diffJson: {
        previousTotalKobo: fee.totalAmountKobo,
        newTotalKobo,
        previousStatus: fee.approvalStatus,
        nextApprovalStatus,
        stretchedClassesCount,
        generatedInvoicesCount,
      },
    });

    if (isAdminActor && dto.approveAndPublish && fee.createdById && fee.createdById !== actorId) {
      try {
        void this.notifications.dispatchNotification({
          userId: fee.createdById,
          schoolId,
          title: 'Fee Structure Reviewed & Approved! 📋✅',
          body: `The School Admin reviewed and approved "${updated.title}". It is now live and locked for Bursary edits.`,
          category: 'FINANCE',
          deepLink: '/schoolFinance',
          dataJson: { feeStructureId: updated.id },
        });
      } catch (err) {}
    }

    return {
      ...updated,
      stretchedClassesCount,
      generatedInvoicesCount,
    };
  }

  async approveFeeStructure(
    schoolId: string,
    feeStructureId: string,
    actorId: string,
    actorRole: string,
    dto?: ApproveFeeStructureDto,
  ) {
    const fee = await this.prisma.feeStructure.findFirst({
      where: { id: feeStructureId, schoolId },
    });
    if (!fee) throw new NotFoundException('Fee structure not found');

    const updated = await this.prisma.feeStructure.update({
      where: { id: feeStructureId },
      data: {
        approvalStatus: 'APPROVED',
        isPublished: true,
        approvedById: actorId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        feeItems: true,
        paymentAccount: true,
        createdBy: { select: { id: true, fullName: true, role: true } },
        approvedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    let generatedInvoicesCount = 0;
    if (dto?.autoGenerateInvoices !== false) {
      generatedInvoicesCount = await this.generateInvoicesForFeeStructure(
        schoolId,
        feeStructureId,
      );
    }

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'FEE_STRUCTURE_APPROVED',
      entityType: 'FeeStructure',
      entityId: fee.id,
      amountKobo: fee.totalAmountKobo,
      diffJson: {
        title: fee.title,
        approvedBy: actorId,
        generatedInvoicesCount,
      },
    });

    this.financeGateway?.emitFinanceUpdate({
      schoolId,
      eventType: 'FEE_APPROVED',
      updatedAt: new Date().toISOString(),
    });

    if (fee.createdById) {
      try {
        void this.notifications.dispatchNotification({
          userId: fee.createdById,
          schoolId,
          title: 'Fee Structure Approved! 📋✅',
          body: `Your fee structure "${fee.title}" has been approved by the School Administration and is now live for students.`,
          category: 'FINANCE',
          deepLink: '/schoolFinance',
          dataJson: { feeStructureId: fee.id },
        });
      } catch (err) {}
    }

    return {
      ...updated,
      generatedInvoicesCount,
    };
  }

  async rejectFeeStructure(
    schoolId: string,
    feeStructureId: string,
    actorId: string,
    actorRole: string,
    dto: RejectFeeStructureDto,
  ) {
    const fee = await this.prisma.feeStructure.findFirst({
      where: { id: feeStructureId, schoolId },
    });
    if (!fee) throw new NotFoundException('Fee structure not found');

    const updated = await this.prisma.feeStructure.update({
      where: { id: feeStructureId },
      data: {
        approvalStatus: 'REJECTED',
        isPublished: false,
        rejectionReason: dto.reason.trim(),
      },
      include: {
        feeItems: true,
        paymentAccount: true,
        createdBy: { select: { id: true, fullName: true, role: true } },
        approvedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    await this.logFinancialAudit({
      schoolId,
      actorId,
      actorRole,
      action: 'FEE_STRUCTURE_REJECTED',
      entityType: 'FeeStructure',
      entityId: fee.id,
      diffJson: {
        title: fee.title,
        reason: dto.reason.trim(),
      },
    });

    if (fee.createdById) {
      try {
        void this.notifications.dispatchNotification({
          userId: fee.createdById,
          schoolId,
          title: 'Fee Structure Requires Changes ⚠️',
          body: `Your fee structure "${fee.title}" was not approved by School Administration. Reason: "${dto.reason.trim()}". Please update and resubmit.`,
          category: 'FINANCE',
          deepLink: '/schoolFinance',
          dataJson: { feeStructureId: fee.id },
        });
      } catch (err) {}
    }

    return updated;
  }

  // ============================================================================
  // 3. AUTOMATIC INVOICE GENERATOR & TARGET SCOPING
  // ============================================================================

  async generateInvoicesForFeeStructure(schoolId: string, feeStructureId: string) {
    const fee = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
      include: {
        school: { select: { id: true, schoolCode: true, name: true, institutionType: true } },
        class: { select: { id: true, name: true, levelCode: true } },
      },
    });
    if (!fee || fee.schoolId !== schoolId) {
      throw new NotFoundException('Fee structure not found');
    }

    // Query matching enrolled students based on targetScope and classId
    const studentsQuery: any = {
      schoolId,
      role: 'STUDENT',
    };

    if (fee.classId) {
      // Match all class assignment paths (direct User.classId, StudentProfile.classId, ClassEnrollment, class name)
      const classOrConditions: any[] = [
        { classId: fee.classId },
        { studentProfile: { classId: fee.classId } },
        { classEnrollments: { some: { classId: fee.classId } } },
      ];
      if (fee.class?.name) {
        classOrConditions.push(
          { schoolClass: { name: { equals: fee.class.name, mode: 'insensitive' } } },
          { studentProfile: { schoolClass: { name: { equals: fee.class.name, mode: 'insensitive' } } } },
        );
        const instUpper = String(fee.school?.institutionType || '').toUpperCase();
        const isTertiary = ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE_OF_EDUCATION', 'TERTIARY'].includes(
          instUpper,
        );
        if (!isTertiary) {
          classOrConditions.push({
            studentProfile: {
              classId: null,
              level: { equals: fee.class.name, mode: 'insensitive' },
            },
          });
        }
      }
      studentsQuery.OR = classOrConditions;
    } else if (fee.targetScope === 'WHOLE_SCHOOL') {
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
    } else if (fee.targetScope === 'LEVEL_OR_CLASS' && fee.levelName) {
      studentsQuery.OR = [
        { studentProfile: { level: fee.levelName } },
        { schoolClass: { name: { equals: fee.levelName, mode: 'insensitive' } } },
        { studentProfile: { schoolClass: { name: { equals: fee.levelName, mode: 'insensitive' } } } },
      ];
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

  /**
   * Reconciles a student's invoices against all currently approved & published fee structures
   * in their institution so students created/moved after fee publication automatically receive
   * matching invoices and shed untouched unpaid invoices from old classes.
   */
  private async syncStudentInvoicesForActiveFees(schoolId: string, studentId: string): Promise<void> {
    const syncKey = `${schoolId}:${studentId}`;
    const existingSync = this.pendingInvoiceSyncs.get(syncKey);
    if (existingSync) {
      return existingSync;
    }

    const syncPromise = this.executeStudentInvoiceSync(schoolId, studentId).finally(() => {
      this.pendingInvoiceSyncs.delete(syncKey);
    });
    this.pendingInvoiceSyncs.set(syncKey, syncPromise);
    return syncPromise;
  }

  private async executeStudentInvoiceSync(schoolId: string, studentId: string): Promise<void> {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, schoolId, role: 'STUDENT' },
      include: {
        school: {
          select: {
            id: true,
            schoolCode: true,
            institutionType: true,
          },
        },
        schoolClass: true,
        studentProfile: {
          include: {
            schoolClass: true,
            department: true,
          },
        },
        classEnrollments: {
          include: { schoolClass: true },
        },
      },
    });
    if (!student) return;

    const instUpper = String(student.school?.institutionType || '').toUpperCase();
    const isTertiary = ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE_OF_EDUCATION', 'TERTIARY'].includes(
      instUpper,
    );

    const effectiveClass =
      student.studentProfile?.schoolClass ||
      student.schoolClass ||
      student.classEnrollments?.[0]?.schoolClass ||
      null;
    const effectiveClassId =
      effectiveClass?.id ||
      student.studentProfile?.classId ||
      student.classId ||
      null;
    const effectiveClassName = effectiveClass?.name || null;
    const effectiveDeptId =
      student.studentProfile?.departmentId || effectiveClass?.departmentId || null;
    const effectiveUnitId = student.studentProfile?.department?.unitId || null;

    // Auto-heal stale level / classId links when a student has a concrete SchoolClass assigned
    if (
      !isTertiary &&
      effectiveClassName &&
      student.studentProfile &&
      (student.studentProfile.level !== effectiveClassName ||
        student.studentProfile.classId !== effectiveClassId)
    ) {
      await this.prisma.studentProfile.update({
        where: { id: student.studentProfile.id },
        data: {
          classId: effectiveClassId,
          level: effectiveClassName,
        },
      });
      student.studentProfile.level = effectiveClassName;
      student.studentProfile.classId = effectiveClassId;
    }

    if (effectiveClassId && student.classId !== effectiveClassId) {
      await this.prisma.user.update({
        where: { id: student.id },
        data: { classId: effectiveClassId },
      });
      student.classId = effectiveClassId;
    }

    const norm = (val?: string | null) => String(val || '').trim().toLowerCase();
    const studentLevelTokens = new Set(
      [
        norm(effectiveClassName),
        norm(effectiveClass?.levelCode),
        norm(student.studentProfile?.level),
      ].filter(Boolean),
    );

    const matchesLevel = (levelName?: string | null): boolean => {
      const target = norm(levelName);
      if (!target) return true;
      if (studentLevelTokens.has(target)) return true;
      if (effectiveClassName) {
        const clsNorm = norm(effectiveClassName);
        if (
          clsNorm === target ||
          clsNorm.startsWith(`${target} `) ||
          (clsNorm.startsWith(target) && /^[a-z]$/i.test(clsNorm.slice(target.length)))
        ) {
          return true;
        }
      }
      return false;
    };

    const doesFeeMatchStudent = (fee: {
      classId?: string | null;
      class?: { name?: string | null } | null;
      targetScope: string;
      unitId?: string | null;
      departmentId?: string | null;
      levelName?: string | null;
    }): boolean => {
      if (fee.classId) {
        if (effectiveClassId && fee.classId === effectiveClassId) return true;
        if (
          fee.class?.name &&
          effectiveClassName &&
          norm(fee.class.name) === norm(effectiveClassName)
        ) {
          return true;
        }
        return false;
      }
      if (fee.targetScope === 'WHOLE_SCHOOL') {
        return fee.levelName ? matchesLevel(fee.levelName) : true;
      }
      if (fee.targetScope === 'FACULTY') {
        return (
          Boolean(fee.unitId && effectiveUnitId && fee.unitId === effectiveUnitId) &&
          (!fee.levelName || matchesLevel(fee.levelName))
        );
      }
      if (fee.targetScope === 'DEPARTMENT') {
        return (
          Boolean(fee.departmentId && effectiveDeptId && fee.departmentId === effectiveDeptId) &&
          (!fee.levelName || matchesLevel(fee.levelName))
        );
      }
      if (fee.targetScope === 'LEVEL_OR_CLASS') {
        return Boolean(fee.levelName && matchesLevel(fee.levelName));
      }
      return false;
    };

    const existingInvoices = await this.prisma.studentInvoice.findMany({
      where: { schoolId, studentId },
      include: {
        feeStructure: { include: { class: true } },
        payments: { select: { id: true } },
        evidences: { select: { id: true } },
      },
    });

    const existingFeeIds = new Set<string>();
    const staleInvoiceIds: string[] = [];

    for (const inv of existingInvoices) {
      const isUntouchedUnpaid =
        inv.paidAmountKobo === 0 &&
        inv.payments.length === 0 &&
        inv.evidences.length === 0;
      const isPublishedApproved =
        inv.feeStructure.isPublished && inv.feeStructure.approvalStatus === 'APPROVED';

      if (
        isUntouchedUnpaid &&
        (!isPublishedApproved ||
          (inv.feeStructure.classId &&
            effectiveClassId &&
            inv.feeStructure.classId !== effectiveClassId))
      ) {
        staleInvoiceIds.push(inv.id);
      } else {
        existingFeeIds.add(inv.feeStructureId);
      }
    }

    if (staleInvoiceIds.length > 0) {
      await this.prisma.studentInvoice.deleteMany({
        where: { id: { in: staleInvoiceIds }, schoolId, studentId },
      });
    }

    const publishedFees = await this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        isPublished: true,
        approvalStatus: 'APPROVED',
      },
      include: { class: true },
    });

    const schoolPrefix = (student.school?.schoolCode || 'SSP').toUpperCase();
    const yearPrefix = new Date().getFullYear();
    const studentTag = student.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
    let seq = existingInvoices.length + 1;

    for (const fee of publishedFees) {
      if (existingFeeIds.has(fee.id)) continue;
      if (!doesFeeMatchStudent(fee)) continue;

      const duplicateCheck = await this.prisma.studentInvoice.findFirst({
        where: { schoolId, studentId, feeStructureId: fee.id },
        select: { id: true },
      });
      if (duplicateCheck) continue;

      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const invoiceNumber = `INV-${schoolPrefix}-${yearPrefix}-${studentTag}${String(seq).padStart(2, '0')}-${randomSuffix}`;
      const qrClearanceToken = `CLR-${schoolPrefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      seq++;

      try {
        await this.prisma.studentInvoice.create({
          data: {
            schoolId,
            studentId,
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
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
      }
    }
  }

  async getStudentInvoices(schoolId: string, studentId: string, status?: string) {
    await this.syncStudentInvoicesForActiveFees(schoolId, studentId);

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
    await this.syncStudentInvoicesForActiveFees(schoolId, studentId);

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: {
        school: { select: { institutionType: true } },
        schoolClass: true,
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

    const instUpper = String(student.school?.institutionType || '').toUpperCase();
    const isTertiary = ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE_OF_EDUCATION', 'TERTIARY'].includes(
      instUpper,
    );
    const resolvedClassOrLevel = isTertiary
      ? student.studentProfile?.level ||
        student.studentProfile?.schoolClass?.name ||
        student.schoolClass?.name ||
        'Current Level'
      : student.studentProfile?.schoolClass?.name ||
        student.schoolClass?.name ||
        student.studentProfile?.level ||
        'Current Class';

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
        level: resolvedClassOrLevel,
      },
      isCleared,
      clearanceStatus: isCleared ? 'CLEARED' : 'OUTSTANDING_FEES',
      primaryClearanceToken,
      platformFeeKobo: this.getPlatformFeeKobo(),
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

  private toPaystackValidEmail(rawEmail?: string | null, fallbackId?: string | null): string {
    const clean = String(rawEmail || '').trim().toLowerCase();
    const normalized = clean.endsWith('.spark')
      ? clean.replace(/\.spark$/, '.studentspark.ng')
      : clean;

    const isValidPublicEmail =
      /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,10}$/i.test(normalized) &&
      !/\.(spark|local|test|invalid)$/i.test(normalized);

    if (isValidPublicEmail) {
      return normalized;
    }

    const safeLocal =
      String(fallbackId || 'student')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 32) || 'student';
    return `${safeLocal}@studentspark.ng`;
  }

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
    let subaccountCode = invoice.feeStructure.paymentAccount?.paystackSubaccountCode || null;

    // Just-in-time auto-provision if account lacks a subaccount code but has valid bank details
    const pAcc = invoice.feeStructure.paymentAccount;
    if (!subaccountCode && pAcc?.bankCode && pAcc?.accountNumber) {
      const autoCode = await this.autoProvisionPaystackSubaccount(
        pAcc.accountName,
        pAcc.bankCode,
        pAcc.accountNumber,
        `${invoice.schoolId} Tuition Collection`,
      );
      if (autoCode) {
        subaccountCode = autoCode;
        await this.prisma.paymentAccount.update({
          where: { id: pAcc.id },
          data: { paystackSubaccountCode: autoCode },
        });
      }
    }

    // Dev/Test & Production subaccount safety:
    // If subaccount is passed, verify it is registered on Paystack to prevent "Invalid Subaccount" crash
    if (subaccountCode) {
      const cleanSub = subaccountCode.trim();
      if (
        cleanSub.includes('placeholder') ||
        cleanSub.includes('dummy') ||
        cleanSub.includes('futo_') ||
        cleanSub.includes('sample') ||
        !cleanSub.startsWith('ACCT_')
      ) {
        this.logger.warn(
          `Omitting mock subaccount "${cleanSub}" for payment ${paystackReference} to prevent Paystack crash.`,
        );
        subaccountCode = null;
      } else {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (secret && !secret.includes('placeholder')) {
          try {
            const checkRes = await fetch(
              `https://api.paystack.co/subaccount/${encodeURIComponent(cleanSub)}`,
              {
                headers: { Authorization: `Bearer ${secret}` },
                signal: AbortSignal.timeout(6000),
              },
            );
            const checkData = (await checkRes.json()) as any;
            if (!checkData.status || !checkData.data?.active) {
              this.logger.warn(
                `Paystack subaccount "${cleanSub}" not found or inactive (${checkData.message || 'Inactive'}). Bypassing split to allow seamless checkout.`,
              );
              subaccountCode = null;
            }
          } catch (err: any) {
            this.logger.warn(`Could not verify subaccount "${cleanSub}": ${err.message}`);
            if (secret.startsWith('sk_test_')) {
              subaccountCode = null;
            }
          }
        }
      }
    }

    const studentMatric = invoice.student.studentProfile?.matricOrAdmissionNo || invoice.student.loginId;
    const platformFeeKobo = this.getPlatformFeeKobo();
    const totalChargeKobo = payAmountKobo + platformFeeKobo;

    return {
      paystackReference,
      amountKobo: payAmountKobo, // school-fee portion credited to the invoice
      platformFeeKobo, // Student Spark convenience fee (on top)
      totalChargeKobo, // amount sent to Paystack (Paystack may add its own fee if "pass fees to customer" is on)
      email: this.toPaystackValidEmail(invoice.student.email, studentMatric || invoice.student.id),
      invoiceNumber: invoice.invoiceNumber,
      title: invoice.feeStructure.title,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_sample_key',
      subaccountCode,
      // Dynamic flat split: school subaccount gets exactly the fee; main account keeps the rest
      // and bears Paystack's processing charge (covered by the customer when fees are passed on).
      split: subaccountCode
        ? {
            type: 'flat' as const,
            bearer_type: 'account' as const,
            subaccounts: [{ subaccount: subaccountCode, share: String(payAmountKobo) }],
          }
        : null,
      metadata: {
        invoiceId: invoice.id,
        schoolId: invoice.schoolId,
        principalKobo: payAmountKobo,
        platformFeeKobo,
      },
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
    if (invoice.studentId !== studentId) {
      throw new ForbiddenException('You cannot verify payment for another student invoice.');
    }

    const existingPayment = await this.prisma.financePayment.findFirst({
      where: {
        paystackReference: dto.paystackReference,
        schoolId,
        studentId,
      },
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
      let data: any = null;
      try {
        const res = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(dto.paystackReference)}`,
          {
            headers: { Authorization: `Bearer ${paystackSecret}` },
            signal: AbortSignal.timeout(10000),
          },
        );
        data = (await res.json()) as any;
      } catch (err: any) {
        this.logger.warn(`Live Paystack verify network check: ${String(err?.message || err)}`);
      }

      if (data) {
        if (data.status && data.data?.status === 'success') {
          verifiedAmountKobo = this.extractSchoolPrincipalKobo(data.data) || verifiedAmountKobo;
        } else {
          throw new BadRequestException(
            data.message || 'Paystack verification failed: Transaction not successful.',
          );
        }
      }
    }

    const amountToCreditKobo = Math.min(verifiedAmountKobo, invoice.balanceAmountKobo);

    return this.applyPaymentSuccess({
      schoolId,
      studentId,
      invoice,
      amountKobo: amountToCreditKobo,
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
    const amountKobo = this.extractSchoolPrincipalKobo(data);

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
        amountKobo: Math.min(amountKobo || invoice.balanceAmountKobo, invoice.balanceAmountKobo),
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
    if (invoice.studentId !== studentId) {
      throw new ForbiddenException('You cannot submit transfer evidence for another student invoice.');
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
        schoolId,
        title: '🏦 New Bank Transfer Proof Submitted',
        body: `${evidence.student.fullName} submitted ₦${(evidence.transferAmountKobo / 100).toLocaleString()} transfer proof for ${evidence.invoice.feeStructure.title}.`,
        category: 'FINANCE',
        deepLink: '/schoolFinance',
        dataJson: { evidenceId: evidence.id, invoiceId: evidence.invoiceId },
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
        schoolId,
        title: '⚠️ Transfer Proof Rejected',
        body: `Your payment proof for ${evidence.invoice.feeStructure.title} was declined: ${dto.reviewNotes || 'Invalid teller or mismatch'}. Please contact Bursary.`,
        category: 'FINANCE',
        deepLink: '/studentFees',
        dataJson: { evidenceId: evidence.id, invoiceId: evidence.invoiceId },
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
      schoolId,
      title: '🎉 Payment Approved & Receipt Issued!',
      body: `Your ₦${(evidence.transferAmountKobo / 100).toLocaleString()} bank transfer for ${evidence.invoice.feeStructure.title} has been confirmed. Tap to download your Digital Receipt.`,
      category: 'FINANCE',
      deepLink: '/studentFees',
      dataJson: { paymentId: result.payment.id, receiptNumber: result.receipt.receiptNumber },
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

    this.financeGateway?.emitFinanceUpdate({
      schoolId,
      eventType: 'PAYMENT_RECORDED',
      invoiceId: invoice.id,
      studentId,
      receiptNumber,
      amountKobo,
      updatedAt: new Date().toISOString(),
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

  // ============================================================================
  // 6. INSTITUTION-WIDE STUDENT INVOICES & TRANSACTION RECEIPTS
  // ============================================================================

  private buildDateRange(fromStr?: string, toStr?: string): { gte?: Date; lte?: Date } | null {
    const cleanFrom = fromStr?.trim();
    const cleanTo = toStr?.trim();
    if (!cleanFrom && !cleanTo) return null;

    const range: { gte?: Date; lte?: Date } = {};
    if (cleanFrom) {
      const start = new Date(`${cleanFrom}T00:00:00.000Z`);
      if (!Number.isNaN(start.getTime())) range.gte = start;
    }
    if (cleanTo) {
      const end = new Date(`${cleanTo}T23:59:59.999Z`);
      if (!Number.isNaN(end.getTime())) range.lte = end;
    }
    if (!range.gte && !range.lte) return null;
    return range;
  }

  private buildStudentSearchOr(search?: string): any[] | null {
    const q = search?.trim();
    if (!q) return null;
    return [
      { student: { fullName: { contains: q, mode: 'insensitive' } } },
      { student: { loginId: { contains: q, mode: 'insensitive' } } },
      { student: { studentCode: { contains: q, mode: 'insensitive' } } },
      {
        student: {
          studentProfile: {
            matricOrAdmissionNo: { contains: q, mode: 'insensitive' },
          },
        },
      },
    ];
  }

  async getSchoolStudentInvoices(
    schoolId: string,
    query?: {
      status?: string;
      feeStructureId?: string;
      classId?: string;
      paidDateFrom?: string;
      paidDateTo?: string;
      search?: string;
      limit?: number;
      page?: number;
    },
  ) {
    const take = query?.limit ? Math.min(Number(query.limit), 200) : 50;
    const skip = query?.page ? (Number(query.page) - 1) * take : 0;

    const andConditions: any[] = [];
    const normalizedStatus = query?.status?.trim().toUpperCase();
    if (normalizedStatus === 'PAID') {
      andConditions.push({
        OR: [{ status: 'PAID' }, { balanceAmountKobo: { lte: 0 } }],
      });
    } else if (
      normalizedStatus === 'HALF_PAID' ||
      normalizedStatus === 'PARTIALLY_PAID'
    ) {
      andConditions.push({
        paidAmountKobo: { gt: 0 },
        balanceAmountKobo: { gt: 0 },
      });
    } else if (normalizedStatus === 'UNPAID') {
      andConditions.push({
        paidAmountKobo: 0,
        balanceAmountKobo: { gt: 0 },
      });
    } else if (normalizedStatus === 'OUTSTANDING') {
      andConditions.push({
        balanceAmountKobo: { gt: 0 },
      });
    } else if (normalizedStatus && normalizedStatus !== 'ALL') {
      andConditions.push({ status: normalizedStatus });
    }

    if (query?.feeStructureId) {
      andConditions.push({ feeStructureId: query.feeStructureId });
    }

    if (query?.classId?.trim()) {
      const cid = query.classId.trim();
      andConditions.push({
        OR: [
          { student: { classId: cid } },
          { student: { studentProfile: { classId: cid } } },
        ],
      });
    }

    const paidDateRange = this.buildDateRange(query?.paidDateFrom, query?.paidDateTo);
    if (paidDateRange) {
      andConditions.push({
        payments: {
          some: {
            status: 'VERIFIED',
            paidAt: paidDateRange,
          },
        },
      });
    }

    const studentSearchOr = this.buildStudentSearchOr(query?.search);
    if (studentSearchOr) {
      andConditions.push({
        OR: [
          { invoiceNumber: { contains: query!.search!.trim(), mode: 'insensitive' } },
          { qrClearanceToken: { contains: query!.search!.trim(), mode: 'insensitive' } },
          ...studentSearchOr,
        ],
      });
    }

    const where: any = {
      schoolId,
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    };

    const [total, invoices] = await Promise.all([
      this.prisma.studentInvoice.count({ where }),
      this.prisma.studentInvoice.findMany({
        where,
        take,
        skip,
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              loginId: true,
              studentCode: true,
              email: true,
              avatarUrl: true,
              classId: true,
              schoolClass: { select: { id: true, name: true } },
              studentProfile: {
                select: {
                  id: true,
                  matricOrAdmissionNo: true,
                  level: true,
                  classId: true,
                  department: { select: { id: true, name: true, code: true } },
                  schoolClass: { select: { id: true, name: true } },
                },
              },
            },
          },
          feeStructure: {
            select: {
              id: true,
              title: true,
              code: true,
              totalAmountKobo: true,
              billingPeriod: true,
              sessionName: true,
              termOrSemester: true,
              classId: true,
            },
          },
          payments: {
            where: { status: 'VERIFIED' },
            orderBy: { paidAt: 'desc' },
            select: {
              id: true,
              amountKobo: true,
              channel: true,
              reference: true,
              paystackReference: true,
              paidAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      page: query?.page || 1,
      limit: take,
      invoices,
    };
  }

  async getSchoolTransactionReceipts(
    schoolId: string,
    query?: {
      channel?: string;
      classId?: string;
      paidDateFrom?: string;
      paidDateTo?: string;
      search?: string;
      limit?: number;
      page?: number;
    },
  ) {
    const take = query?.limit ? Math.min(Number(query.limit), 200) : 50;
    const skip = query?.page ? (Number(query.page) - 1) * take : 0;

    const andConditions: any[] = [];
    if (query?.channel && query.channel !== 'ALL') {
      andConditions.push({ payment: { channel: query.channel } });
    }
    if (query?.classId?.trim()) {
      const cid = query.classId.trim();
      andConditions.push({
        OR: [
          { student: { classId: cid } },
          { student: { studentProfile: { classId: cid } } },
        ],
      });
    }
    const paidDateRange = this.buildDateRange(query?.paidDateFrom, query?.paidDateTo);
    if (paidDateRange) {
      andConditions.push({
        OR: [
          { payment: { paidAt: paidDateRange } },
          { issuedAt: paidDateRange },
        ],
      });
    }
    const studentSearchOr = this.buildStudentSearchOr(query?.search);
    if (studentSearchOr) {
      andConditions.push({
        OR: [
          { receiptNumber: { contains: query!.search!.trim(), mode: 'insensitive' } },
          ...studentSearchOr,
        ],
      });
    }

    const where: any = {
      schoolId,
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    };

    const [total, receipts] = await Promise.all([
      this.prisma.financeReceipt.count({ where }),
      this.prisma.financeReceipt.findMany({
        where,
        take,
        skip,
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              loginId: true,
              studentCode: true,
              avatarUrl: true,
              schoolClass: { select: { id: true, name: true } },
              studentProfile: {
                select: {
                  matricOrAdmissionNo: true,
                  level: true,
                  schoolClass: { select: { id: true, name: true } },
                },
              },
            },
          },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              feeStructure: {
                select: {
                  id: true,
                  title: true,
                  sessionName: true,
                  termOrSemester: true,
                },
              },
            },
          },
          payment: {
            select: {
              id: true,
              amountKobo: true,
              channel: true,
              reference: true,
              paystackReference: true,
              posTerminalRef: true,
              bankTellerNo: true,
              paidAt: true,
              createdAt: true,
              recordedBy: { select: { id: true, fullName: true, role: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),
    ]);

    return {
      total,
      page: query?.page || 1,
      limit: take,
      receipts,
    };
  }

  async getClassPaymentReport(
    schoolId: string,
    classId: string,
    params?: {
      paymentStatus?: string;
      paidDateFrom?: string;
      paidDateTo?: string;
      search?: string;
    },
  ) {
    const schoolClass = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            schoolCode: true,
            logoUrl: true,
            primaryColor: true,
            institutionType: true,
          },
        },
        department: { select: { id: true, name: true, code: true } },
      },
    });
    if (!schoolClass) {
      throw new NotFoundException('Class / Level not found in this institution.');
    }

    const rawStatus = String(params?.paymentStatus || 'PAID').trim().toUpperCase();
    const paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' =
      rawStatus === 'HALF_PAID' || rawStatus === 'PARTIALLY_PAID'
        ? 'PARTIALLY_PAID'
        : rawStatus === 'UNPAID'
          ? 'UNPAID'
          : 'PAID';

    // Ensure every student in this class has up-to-date published invoices synced
    const classStudentUsers = await this.prisma.user.findMany({
      where: {
        schoolId,
        role: 'STUDENT',
        OR: [{ classId }, { studentProfile: { classId } }],
      },
      select: { id: true },
    });

    for (const stu of classStudentUsers) {
      await this.syncStudentInvoicesForActiveFees(schoolId, stu.id);
    }

    const andConditions: any[] = [
      {
        OR: [
          { student: { classId } },
          { student: { studentProfile: { classId } } },
        ],
      },
    ];

    if (paymentStatus === 'PAID') {
      andConditions.push({
        OR: [{ status: 'PAID' }, { balanceAmountKobo: { lte: 0 } }],
      });
    } else if (paymentStatus === 'PARTIALLY_PAID') {
      andConditions.push({
        paidAmountKobo: { gt: 0 },
        balanceAmountKobo: { gt: 0 },
      });
    } else {
      andConditions.push({
        paidAmountKobo: 0,
        balanceAmountKobo: { gt: 0 },
      });
    }

    const paidDateRange = this.buildDateRange(params?.paidDateFrom, params?.paidDateTo);
    if (paidDateRange) {
      andConditions.push({
        payments: {
          some: {
            status: 'VERIFIED',
            paidAt: paidDateRange,
          },
        },
      });
    }

    const studentSearchOr = this.buildStudentSearchOr(params?.search);
    if (studentSearchOr) {
      andConditions.push({
        OR: [
          { invoiceNumber: { contains: params!.search!.trim(), mode: 'insensitive' } },
          ...studentSearchOr,
        ],
      });
    }

    const [invoices, currentTerm] = await Promise.all([
      this.prisma.studentInvoice.findMany({
        where: { schoolId, AND: andConditions },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              loginId: true,
              studentCode: true,
              avatarUrl: true,
              studentProfile: {
                select: {
                  matricOrAdmissionNo: true,
                  level: true,
                },
              },
            },
          },
          feeStructure: {
            select: {
              id: true,
              title: true,
              sessionName: true,
              termOrSemester: true,
            },
          },
          payments: {
            where: { status: 'VERIFIED' },
            orderBy: { paidAt: 'desc' },
            select: {
              id: true,
              amountKobo: true,
              channel: true,
              paidAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ student: { fullName: 'asc' } }, { createdAt: 'desc' }],
      }),
      this.prisma.academicTerm.findFirst({
        where: { session: { schoolId } },
        orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
        include: { session: { select: { name: true } } },
      }),
    ]);

    const rows = invoices.map((inv) => {
      const latestPayment = inv.payments[0] || null;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        studentId: inv.studentId,
        fullName: inv.student.fullName || 'Student',
        uniqueId:
          inv.student.studentProfile?.matricOrAdmissionNo ||
          inv.student.loginId ||
          inv.student.studentCode ||
          'N/A',
        feeTitle: inv.feeStructure?.title || 'Academic Fee',
        sessionName: inv.feeStructure?.sessionName || currentTerm?.session?.name || '',
        termName: inv.feeStructure?.termOrSemester || currentTerm?.name || '',
        totalAmountKobo: inv.totalAmountKobo,
        paidAmountKobo: inv.paidAmountKobo,
        balanceAmountKobo: inv.balanceAmountKobo,
        status: inv.status,
        lastPaidAt:
          latestPayment?.paidAt?.toISOString() ||
          latestPayment?.createdAt?.toISOString() ||
          inv.clearedAt?.toISOString() ||
          null,
        lastChannel: latestPayment?.channel || null,
      };
    });

    const totalInvoicedKobo = rows.reduce((sum, r) => sum + r.totalAmountKobo, 0);
    const totalPaidKobo = rows.reduce((sum, r) => sum + r.paidAmountKobo, 0);
    const totalBalanceKobo = rows.reduce((sum, r) => sum + r.balanceAmountKobo, 0);

    return {
      school: schoolClass.school,
      schoolClass: {
        id: schoolClass.id,
        name: schoolClass.name,
        levelCode: schoolClass.levelCode,
        departmentName: schoolClass.department?.name || null,
      },
      currentTerm: currentTerm
        ? {
            id: currentTerm.id,
            name: currentTerm.name,
            sessionName: currentTerm.session?.name || '',
          }
        : null,
      paymentStatus,
      filters: {
        paidDateFrom: params?.paidDateFrom || null,
        paidDateTo: params?.paidDateTo || null,
        search: params?.search?.trim() || null,
      },
      generatedAt: new Date().toISOString(),
      summary: {
        count: rows.length,
        totalStudentsInClass: classStudentUsers.length,
        totalInvoicedKobo,
        totalPaidKobo,
        totalBalanceKobo,
      },
      rows,
    };
  }
}
