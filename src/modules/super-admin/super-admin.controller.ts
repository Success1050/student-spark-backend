import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';

@Controller(['super-admin', 'api/super-admin'])
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get('overview')
  getOverview() {
    return this.superAdminService.getGlobalOverview();
  }

  @Get('directory/search')
  searchDirectory(
    @Query('q') query?: string,
    @Query('role') role?: string,
  ) {
    return this.superAdminService.searchGlobalDirectory(query, role);
  }
}
