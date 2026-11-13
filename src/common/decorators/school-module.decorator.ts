import { SetMetadata } from '@nestjs/common';

export type SchoolFeatureModule =
  | 'CLASS_NOTES'
  | 'ATTENDANCE'
  | 'CBT_ASSESSMENTS'
  | 'AUTO_GRADING_REPORT_CARDS'
  | 'FEE_COLLECTION'
  | 'STUDY_COMMUNITIES'
  | 'ELIBRARY_MARKETPLACE'
  | 'AI_STUDY_TOOLS'
  | 'GAMES_ARCADE';

export const SCHOOL_MODULE_KEY = 'required_school_module';
export const RequireSchoolModule = (...modules: SchoolFeatureModule[]) =>
  SetMetadata(SCHOOL_MODULE_KEY, modules);
