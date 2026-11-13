import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Replaces Supabase Row-Level Security (RLS) for School Multi-Tenancy.
 * Ensures School Admins, Teachers, and Students can only access their own schoolId.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.role === 'SUPER_ADMIN') return true;

    const requestedSchoolId =
      request.params?.schoolId ||
      request.headers['x-school-id'] ||
      request.body?.schoolId;

    if (requestedSchoolId && user?.schoolId !== requestedSchoolId) {
      throw new ForbiddenException('Cross-tenant access denied for this school portal');
    }

    return true;
  }
}
