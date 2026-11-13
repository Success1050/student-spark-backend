import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  AUDIT_ACTION_KEY,
  AuditActionMetadata,
} from '../decorators/audit-action.decorator.js';
import { AuditLogService } from '../../modules/audit-log/audit-log.service.js';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.getAllAndOverride<AuditActionMetadata>(
      AUDIT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          this.recordLog(request, meta, responseBody, null, startTime);
        },
        error: (err) => {
          this.recordLog(request, meta, null, err, startTime);
        },
      }),
    );
  }

  private recordLog(
    request: any,
    meta: AuditActionMetadata,
    responseBody: any,
    error: any,
    startTime: number,
  ) {
    const user = request.user;
    const ipAddress =
      request.headers['x-forwarded-for'] ||
      request.socket?.remoteAddress ||
      request.ip ||
      null;
    const userAgent = request.headers['user-agent'] || null;

    const schoolId =
      user?.schoolId ||
      user?.activeTenantId ||
      request.headers['x-school-id'] ||
      request.params?.schoolId ||
      request.body?.schoolId ||
      null;

    const entityId =
      request.params?.id ||
      responseBody?.data?.id ||
      responseBody?.id ||
      request.body?.id ||
      null;

    const durationMs = Date.now() - startTime;

    this.auditLogService.record({
      schoolId: schoolId ? String(schoolId) : null,
      userId: user?.id || user?.sub || null,
      actorName: user?.fullName || user?.username || null,
      actorEmail: user?.email || null,
      actorRole: user?.role || null,
      action: meta.action,
      entityType: meta.entityType,
      entityId: entityId ? String(entityId) : null,
      metadata: {
        method: request.method,
        url: request.originalUrl || request.url,
        statusCode: error ? (error.status || 500) : 200,
        success: !error,
        durationMs,
        errorMessage: error?.message || undefined,
        bodyKeys: request.body ? Object.keys(request.body) : [],
      },
      ipAddress: ipAddress ? String(ipAddress) : null,
      userAgent: userAgent ? String(userAgent) : null,
    });
  }
}
