import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SCHOOL_MODULE_KEY,
  SchoolFeatureModule,
} from '../decorators/school-module.decorator.js';

/**
 * Verifies that a School Tenant's active subscription plan (configured by SuperAdmin)
 * includes access to the requested module(s).
 */
@Injectable()
export class SchoolModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModules = this.reflector.getAllAndOverride<SchoolFeatureModule[]>(
      SCHOOL_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredModules || requiredModules.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (user?.role === 'SUPER_ADMIN') return true;

    const enabledSchoolModules: SchoolFeatureModule[] | undefined =
      request.schoolSubscription?.enabledModules;

    if (
      enabledSchoolModules &&
      !requiredModules.every((mod) => enabledSchoolModules.includes(mod))
    ) {
      throw new ForbiddenException(
        `Your school's current subscription plan does not include the [${requiredModules.join(', ')}] module. Contact your School Admin to upgrade.`,
      );
    }

    return true;
  }
}
