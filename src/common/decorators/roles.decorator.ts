import { SetMetadata } from '@nestjs/common';

export type AppRole =
  | 'STUDENT'
  | 'TEACHER'
  | 'SCHOOL_ADMIN'
  | 'SCHOOL_FINANCE'
  | 'SUPER_ADMIN';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
