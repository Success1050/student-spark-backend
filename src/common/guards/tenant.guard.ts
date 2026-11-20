import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Enforces School Multi-Tenancy across params, query, body, and headers.
 * Ensures School Admins, Bursars, Teachers, and Students can only access their own schoolId.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.role === 'SUPER_ADMIN') return true;

    const candidateSchoolIds = [
      request.params?.schoolId,
      request.query?.schoolId,
      request.body?.schoolId,
      request.headers?.['x-school-id'],
    ]
      .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
      .filter((v) => v && v !== 'undefined' && v !== 'null');

    if (candidateSchoolIds.length > 0) {
      if (!user?.schoolId || candidateSchoolIds.some((id) => id !== user.schoolId)) {
        throw new ForbiddenException('Cross-tenant access denied for this school portal');
      }
    }

    return true;
  }
}
