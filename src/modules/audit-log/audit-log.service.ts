import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export interface CreateAuditLogParams {
  schoolId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface QueryAuditLogsParams {
  schoolId?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asynchronously records an audit event without blocking execution
   */
  async record(params: CreateAuditLogParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          schoolId: params.schoolId || undefined,
          userId: params.userId || undefined,
          actorName: params.actorName || undefined,
          actorEmail: params.actorEmail || undefined,
          actorRole: params.actorRole || undefined,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId || undefined,
          metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
          ipAddress: params.ipAddress || undefined,
          userAgent: params.userAgent ? params.userAgent.substring(0, 500) : undefined,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to record audit log: ${err.message}`, err.stack);
    }
  }

  /**
   * Retrieves paginated audit logs scoped by school (or globally for superadmin)
   */
  async getAuditLogs(params: QueryAuditLogsParams) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.schoolId) where.schoolId = params.schoolId;
    if (params.userId) where.userId = params.userId;
    if (params.action) where.action = { contains: params.action, mode: 'insensitive' };
    if (params.entityType) where.entityType = { contains: params.entityType, mode: 'insensitive' };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
