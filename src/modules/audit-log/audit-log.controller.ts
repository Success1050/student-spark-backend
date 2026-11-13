import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from './audit-log.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';

@Controller(['audit-logs', 'api/audit-logs'])
@UseGuards(RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  async getAuditLogs(
    @Query('schoolId') schoolId: string,
    @Query('userId') targetUserId: string,
    @Query('action') action: string,
    @Query('entityType') entityType: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Req() req: any,
  ) {
    const user = req.user;
    // School Admin is strictly scoped to their own school
    const effectiveSchoolId =
      user?.role === 'SUPER_ADMIN' ? schoolId : user?.schoolId || schoolId;

    return this.auditLogService.getAuditLogs({
      schoolId: effectiveSchoolId,
      userId: targetUserId,
      action,
      entityType,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }
}
