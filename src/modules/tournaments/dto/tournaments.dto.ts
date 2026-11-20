import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TournamentQuestionInputDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(600)
  prompt: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  options: string[];

  @IsInt()
  @Min(0)
  @Max(5)
  correctIndex: number;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1000)
  points?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  timeLimitSeconds?: number;
}

export class CreateTournamentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  subjectArea: string;

  @IsOptional()
  @IsIn(['ENGINEERING_CS', 'SECONDARY_STEM', 'NATIONAL_SCHOLARS', 'CUSTOM'])
  questionBankKey?: 'ENGINEERING_CS' | 'SECONDARY_STEM' | 'NATIONAL_SCHOLARS' | 'CUSTOM';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetInstitutionTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDepartments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedLevels?: string[];

  @IsOptional()
  @IsBoolean()
  allowIndependentLearners?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxParticipantsPerSchool?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(500)
  maxTotalParticipants?: number;

  @IsOptional()
  @IsBoolean()
  requireAdminApproval?: boolean;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(90)
  secondsPerQuestion?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  maxTabSwitchesAllowed?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  prizePoolText?: string;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsIn(['REGISTRATION_OPEN', 'LIVE', 'DRAFT'])
  status?: 'REGISTRATION_OPEN' | 'LIVE' | 'DRAFT';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TournamentQuestionInputDto)
  questions?: TournamentQuestionInputDto[];
}

export class UpdateTournamentStatusDto {
  @IsIn(['DRAFT', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'CANCELLED'])
  status: 'DRAFT' | 'REGISTRATION_OPEN' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
}

export class AdminRegisterStudentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  studentIds: string[];
}

export class SubmitTournamentAnswerDto {
  @IsNotEmpty()
  @IsString()
  questionId: string;

  @IsInt()
  @Min(-1)
  @Max(5)
  selectedIndex: number;

  @IsInt()
  @Min(0)
  @Max(180000)
  responseTimeMs: number;
}

export class ReportAntiCheatEventDto {
  @IsIn(['APP_BACKGROUND', 'SCREEN_BLUR', 'SUSPICIOUS_TIMING'])
  eventType: 'APP_BACKGROUND' | 'SCREEN_BLUR' | 'SUSPICIOUS_TIMING';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string;
}

export class SendSpectatorCheerDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string;
}
