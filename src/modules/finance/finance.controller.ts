import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../database/prisma.service.js';
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
import { FinanceService } from './finance.service.js';

@Controller(['finance', 'api/finance'])
@UseGuards(RolesGuard)
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveSchoolId(userId: string, explicitSchoolId?: string): Promise<{ schoolId: string; role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { schoolId: true, role: true },
    });
    if (!user) {
      throw new BadRequestException('Authenticated user account not found.');
    }

    if (user.role === 'SUPER_ADMIN') {
      const targetSchoolId = explicitSchoolId || user.schoolId;
      if (!targetSchoolId) {
        throw new BadRequestException('Target schoolId is required.');
      }
      return { schoolId: targetSchoolId, role: user.role };
    }

    if (!user.schoolId) {
      throw new BadRequestException('User is not assigned to an active institution.');
    }

    if (explicitSchoolId && explicitSchoolId !== user.schoolId) {
      throw new ForbiddenException('Cross-tenant access denied: You cannot access another institution.');
    }

    return { schoolId: user.schoolId, role: user.role };
  }

  // ============================================================================
  // 1. PAYMENT ACCOUNTS (INSTITUTION & FACULTY BANK ACCOUNTS)
  // ============================================================================

  @Get('accounts')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'STUDENT', 'TEACHER', 'SUPER_ADMIN')
  async getPaymentAccounts(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getPaymentAccounts(ctx.schoolId);
  }

  @Post('accounts')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACCOUNT_CREATED', 'PaymentAccount')
  async createPaymentAccount(
    @UserId() userId: string,
    @Body() dto: CreatePaymentAccountDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.createPaymentAccount(ctx.schoolId, userId, ctx.role, dto);
  }

  @Patch('accounts/:id/default')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async setDefaultAccount(
    @UserId() userId: string,
    @Param('id') accountId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.setDefaultPaymentAccount(ctx.schoolId, accountId);
  }

  @Get('banks')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'STUDENT', 'TEACHER', 'SUPER_ADMIN')
  async getBanks() {
    return this.financeService.getBankList();
  }

  @Get('resolve-account')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async resolveAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    return this.financeService.resolveBankAccount(accountNumber, bankCode);
  }

  @Patch('accounts/:id')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACCOUNT_UPDATED', 'PaymentAccount')
  async updatePaymentAccount(
    @UserId() userId: string,
    @Param('id') accountId: string,
    @Body() dto: UpdatePaymentAccountDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.updatePaymentAccount(
      ctx.schoolId,
      accountId,
      userId,
      ctx.role,
      dto,
    );
  }

  @Delete('accounts/:id')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('ACCOUNT_DELETED', 'PaymentAccount')
  async deletePaymentAccount(
    @UserId() userId: string,
    @Param('id') accountId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.deletePaymentAccount(
      ctx.schoolId,
      accountId,
      userId,
      ctx.role,
    );
  }

  // ============================================================================
  // 2. FEE STRUCTURES & CONFIG OPTIONS
  // ============================================================================

  @Get('config-options')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'STUDENT', 'TEACHER', 'SUPER_ADMIN')
  async getConfigOptions(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getFinanceConfigOptions(ctx.schoolId);
  }

  @Get('fee-structures')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'STUDENT', 'TEACHER', 'SUPER_ADMIN')
  async getFeeStructures(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
    @Query('targetScope') targetScope?: string,
    @Query('unitId') unitId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('classId') classId?: string,
    @Query('termId') termId?: string,
    @Query('levelName') levelName?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getFeeStructures(ctx.schoolId, {
      targetScope,
      unitId,
      departmentId,
      classId,
      termId,
      levelName,
      onlyPublished: ctx.role === 'STUDENT',
    });
  }

  @Post('fee-structures')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('FEE_STRUCTURE_CREATED', 'FeeStructure')
  async createFeeStructure(
    @UserId() userId: string,
    @Body() dto: CreateFeeStructureDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.createFeeStructure(ctx.schoolId, userId, ctx.role, dto);
  }

  @Patch('fee-structures/:id')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('FEE_STRUCTURE_UPDATED', 'FeeStructure')
  async updateFeeStructure(
    @UserId() userId: string,
    @Param('id') feeStructureId: string,
    @Body() dto: UpdateFeeStructureDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.updateFeeStructure(
      ctx.schoolId,
      feeStructureId,
      userId,
      ctx.role,
      dto,
    );
  }

  @Patch('fee-structures/:id/approve')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('FEE_STRUCTURE_APPROVED', 'FeeStructure')
  async approveFeeStructure(
    @UserId() userId: string,
    @Param('id') feeStructureId: string,
    @Body() dto: ApproveFeeStructureDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.approveFeeStructure(
      ctx.schoolId,
      feeStructureId,
      userId,
      ctx.role,
      dto,
    );
  }

  @Patch('fee-structures/:id/reject')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('FEE_STRUCTURE_REJECTED', 'FeeStructure')
  async rejectFeeStructure(
    @UserId() userId: string,
    @Param('id') feeStructureId: string,
    @Body() dto: RejectFeeStructureDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.rejectFeeStructure(
      ctx.schoolId,
      feeStructureId,
      userId,
      ctx.role,
      dto,
    );
  }

  @Get('students/invoices')
  @Roles('SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN')
  async getSchoolStudentInvoices(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
    @Query('status') status?: string,
    @Query('feeStructureId') feeStructureId?: string,
    @Query('classId') classId?: string,
    @Query('paidDateFrom') paidDateFrom?: string,
    @Query('paidDateTo') paidDateTo?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getSchoolStudentInvoices(ctx.schoolId, {
      status,
      feeStructureId,
      classId,
      paidDateFrom,
      paidDateTo,
      search,
      page,
      limit,
    });
  }

  @Get('receipts')
  @Roles('SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN')
  async getSchoolTransactionReceipts(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
    @Query('channel') channel?: string,
    @Query('classId') classId?: string,
    @Query('paidDateFrom') paidDateFrom?: string,
    @Query('paidDateTo') paidDateTo?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getSchoolTransactionReceipts(ctx.schoolId, {
      channel,
      classId,
      paidDateFrom,
      paidDateTo,
      search,
      page,
      limit,
    });
  }

  @Get('classes/:classId/payment-report')
  @Roles('SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN')
  async getClassPaymentReport(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Query('schoolId') schoolId?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('paidDateFrom') paidDateFrom?: string,
    @Query('paidDateTo') paidDateTo?: string,
    @Query('search') search?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getClassPaymentReport(ctx.schoolId, classId, {
      paymentStatus,
      paidDateFrom,
      paidDateTo,
      search,
    });
  }

  // ============================================================================
  // 3. STUDENT INVOICES & DIGITAL CLEARANCE CARD
  // ============================================================================

  @Get('student/invoices')
  @Roles('STUDENT', 'SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async getStudentInvoices(
    @UserId() userId: string,
    @Query('studentId') studentId?: string,
    @Query('schoolId') schoolId?: string,
    @Query('status') status?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    const targetStudentId = (ctx.role === 'STUDENT' || !studentId) ? userId : studentId;
    return this.financeService.getStudentInvoices(ctx.schoolId, targetStudentId, status);
  }

  @Get('student/clearance')
  @Roles('STUDENT', 'SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async getStudentClearance(
    @UserId() userId: string,
    @Query('studentId') studentId?: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    const targetStudentId = (ctx.role === 'STUDENT' || !studentId) ? userId : studentId;
    return this.financeService.getStudentClearanceStatus(ctx.schoolId, targetStudentId);
  }

  // ============================================================================
  // 4. 4 PAYMENT CHANNELS: PAYSTACK, CASH, POS, TRANSFER PROOF
  // ============================================================================

  @Post('paystack/init')
  @Roles('STUDENT', 'SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async initPaystackPayment(
    @UserId() userId: string,
    @Body() dto: InitOnlinePaymentDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.initOnlinePayment(ctx.schoolId, userId, dto);
  }

  @Post('paystack/verify')
  @Roles('STUDENT', 'SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async verifyPaystackPayment(
    @UserId() userId: string,
    @Body() dto: VerifyOnlinePaymentDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.verifyOnlinePayment(ctx.schoolId, userId, dto);
  }

  @Post('walk-in')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('PAYMENT_RECORDED_WALKIN', 'FinancePayment')
  async recordWalkInPayment(
    @UserId() userId: string,
    @Body() dto: RecordWalkInPaymentDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.recordWalkInPayment(ctx.schoolId, userId, ctx.role, dto);
  }

  @Post('transfer-evidence')
  @Roles('STUDENT', 'SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async submitTransferEvidence(
    @UserId() userId: string,
    @Body() dto: SubmitTransferEvidenceDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.submitTransferEvidence(ctx.schoolId, userId, dto);
  }

  @Get('transfer-evidence/pending')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async getPendingTransferEvidences(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getPendingTransferEvidences(ctx.schoolId);
  }

  @Post('transfer-evidence/:id/review')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('TRANSFER_PROOF_REVIEWED', 'PaymentEvidence')
  async reviewTransferEvidence(
    @UserId() userId: string,
    @Param('id') evidenceId: string,
    @Body() dto: ReviewTransferEvidenceDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.reviewTransferEvidence(
      ctx.schoolId,
      userId,
      ctx.role,
      evidenceId,
      dto,
    );
  }

  // ============================================================================
  // 5. BULK BANK STATEMENT CSV RECONCILIATION
  // ============================================================================

  @Post('reconciliation/csv')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('BANK_RECONCILIATION_UPLOADED', 'ReconciliationBatch')
  async reconcileBankStatementCsv(
    @UserId() userId: string,
    @Body() dto: ReconciliationCsvDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.reconcileBankStatementCsv(ctx.schoolId, userId, ctx.role, dto);
  }

  // ============================================================================
  // 6. QR RECEIPT & CLEARANCE VERIFICATION
  // ============================================================================

  @Get('receipt/verify/:qrToken')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN')
  async getReceiptByQrToken(@Param('qrToken') qrToken: string) {
    return this.financeService.getReceiptByQrToken(qrToken);
  }

  @Get('clearance/verify/:token')
  @Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SCHOOL_FINANCE', 'SUPER_ADMIN')
  async verifyClearanceByToken(@Param('token') token: string) {
    return this.financeService.verifyClearanceByToken(token);
  }

  // ============================================================================
  // 7. FINANCIAL ANALYTICS & DASHBOARD
  // ============================================================================

  @Get('analytics')
  @Roles('SCHOOL_FINANCE', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  async getFinanceAnalytics(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveSchoolId(userId, schoolId);
    return this.financeService.getFinanceAnalytics(ctx.schoolId);
  }
}
