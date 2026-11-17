import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePaymentAccountDto {
  @IsNotEmpty()
  @IsString()
  accountName: string;

  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @IsNotEmpty()
  @IsString()
  bankName: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  accountType?: string; // CENTRAL_BURSARY | FACULTY_ACCOUNT | DEPARTMENTAL_ACCOUNT | OTHER

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  paystackSubaccountCode?: string;
}

export class UpdatePaymentAccountDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  accountType?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  paystackSubaccountCode?: string;
}

export class CreateFeeItemDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amountKobo: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateFeeStructureDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  sessionName?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  termOrSemester?: string;

  @IsOptional()
  @IsIn(['WHOLE_SCHOOL', 'FACULTY', 'DEPARTMENT', 'LEVEL_OR_CLASS'])
  targetScope?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  levelName?: string; // e.g. "100L", "200L", "ND 1", "JSS 1"

  @IsOptional()
  @IsString()
  paymentAccountId?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPartialPayment?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPartialKobo?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFeeItemDto)
  items: CreateFeeItemDto[];

  @IsOptional()
  @IsBoolean()
  autoGenerateInvoices?: boolean;
}

export class RecordWalkInPaymentDto {
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(100)
  amountKobo: number;

  @IsNotEmpty()
  @IsIn(['CASH', 'POS', 'BANK_TRANSFER'])
  channel: string;

  @IsOptional()
  @IsString()
  posTerminalRef?: string;

  @IsOptional()
  @IsString()
  bankTellerNo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class InitOnlinePaymentDto {
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @IsOptional()
  @IsNumber()
  @Min(100)
  amountKobo?: number;
}

export class VerifyOnlinePaymentDto {
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @IsNotEmpty()
  @IsString()
  paystackReference: string;
}

export class SubmitTransferEvidenceDto {
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @IsNotEmpty()
  @IsString()
  payerName: string;

  @IsOptional()
  @IsString()
  payerBankName?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(100)
  transferAmountKobo: number;

  @IsOptional()
  @IsString()
  transferDate?: string;

  @IsOptional()
  @IsString()
  proofImageUrl?: string;

  @IsOptional()
  @IsString()
  proofBase64?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  submissionNotes?: string;
}

export class ReviewTransferEvidenceDto {
  @IsNotEmpty()
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  reviewNotes?: string;
}

export class ReconciliationCsvDto {
  @IsOptional()
  @IsString()
  csvText?: string;

  @IsOptional()
  @IsString()
  csvBase64?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  paymentAccountId?: string;
}
