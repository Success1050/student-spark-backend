import { Controller, Get } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service.js';

@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get('overview')
  getOverview() {
    return this.superAdminService.getGlobalOverview();
  }
}
