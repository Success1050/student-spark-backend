import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCommunityDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsOptional()
  @IsIn(['MY_CAMPUS', 'CROSS_SCHOOL'])
  zone?: 'MY_CAMPUS' | 'CROSS_SCHOOL';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  initialChannels?: string[];
}

export class CreateChannelDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  topic?: string;

  @IsOptional()
  @IsIn(['TEXT', 'ANNOUNCEMENTS', 'STUDY_MATERIALS', 'QNA'])
  channelType?: string;

  @IsOptional()
  @IsBoolean()
  isReadOnlyForStudents?: boolean;
}

export class JoinCommunityByCodeDto {
  @IsNotEmpty()
  @IsString()
  inviteCode: string;
}

export class SendChannelMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(3000)
  content: string;

  @IsOptional()
  @IsString()
  attachmentType?: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;

  @IsOptional()
  @IsObject()
  attachmentMeta?: Record<string, any>;

  @IsOptional()
  @IsString()
  replyToId?: string;
}

export class ToggleReactionDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(16)
  emoji: string;
}

export class StartDmDto {
  @IsNotEmpty()
  @IsString()
  recipientId: string;
}

export class SendDmMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(3000)
  content: string;

  @IsOptional()
  @IsString()
  attachmentType?: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;

  @IsOptional()
  @IsObject()
  attachmentMeta?: Record<string, any>;
}

export class UploadCommunityMediaDto {
  @IsNotEmpty()
  @IsString()
  base64: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(180)
  fileName: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsIn(['IMAGE', 'DOCUMENT'])
  kind: 'IMAGE' | 'DOCUMENT';
}
