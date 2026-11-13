import { InstitutionType, MarketplaceVisibilityScope } from '@prisma/client';

export class CreateMarketplaceItemDto {
  title: string;
  description: string;
  authorName?: string;
  courseCode?: string;
  institutionType?: InstitutionType;
  visibilityScope?: MarketplaceVisibilityScope;
  priceKobo?: number;
  isFree?: boolean;
  coverUrl?: string;
  encryptedFileUrl?: string;
  pageCount?: number;
  facultyName?: string;
  departmentName?: string;
  levelName?: string;
  termOrSemester?: string;
  schoolId?: string;
  classId?: string;
  subjectId?: string;
  fileSize?: number;
  format?: string;
}

export class QueryMarketplaceDto {
  shelf?: 'COURSE_OR_CLASS' | 'INSTITUTION_SCOPED' | 'PUBLIC_MARKETPLACE' | 'ALL' | 'MY_UPLOADS';
  institutionType?: InstitutionType;
  courseCode?: string;
  facultyName?: string;
  departmentName?: string;
  levelName?: string;
  schoolId?: string;
  classId?: string;
  search?: string;
  isFree?: boolean | string;
  userId?: string;
}

export class InitPurchaseDto {
  itemId: string;
}

export class VerifyPurchaseDto {
  itemId: string;
  paystackReference: string;
}
