import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class StudentPromotionDecisionDto {
  @IsString()
  studentId: string;

  @IsIn(['PROMOTED', 'ON_TRIAL', 'REPEATED', 'GRADUATED'])
  decision: 'PROMOTED' | 'ON_TRIAL' | 'REPEATED' | 'GRADUATED';

  @IsOptional()
  @IsString()
  targetClassId?: string;

  @IsOptional()
  @IsString()
  targetClassName?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class TeacherConfirmPromotionDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentPromotionDecisionDto)
  exceptions?: StudentPromotionDecisionDto[];
}

export class ExecuteClassPromotionDto {
  @IsString()
  classId: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  targetClassId?: string;

  @IsOptional()
  @IsString()
  targetClassName?: string;

  @IsOptional()
  @IsBoolean()
  markAsGraduating?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  passMarkPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  trialMarkPercent?: number;

  @IsOptional()
  @IsBoolean()
  autoCreateTargetClass?: boolean;

  @IsOptional()
  @IsBoolean()
  autoIssueNewClassFees?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentPromotionDecisionDto)
  overrides?: StudentPromotionDecisionDto[];

  @IsOptional()
  @IsString()
  toSessionName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ExecuteSchoolRolloverDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classIds?: string[]; // If omitted, promotes all eligible classes top-down

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  passMarkPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  trialMarkPercent?: number;

  @IsOptional()
  @IsBoolean()
  autoCreateMissingClasses?: boolean;

  @IsOptional()
  @IsBoolean()
  autoIssueNewClassFees?: boolean;

  @IsOptional()
  @IsString()
  createNextSessionName?: string; // e.g. "2026/2027" - optionally creates & activates new session + First Term

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentPromotionDecisionDto)
  overrides?: StudentPromotionDecisionDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
