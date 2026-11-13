import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Web-Based SuperAdmin Portal Service (exclusively for the Platform Owner)
 * Provides global revenue metrics, school tenant management, marketplace moderation,
 * and withdrawal payout approvals.
 */
@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobalOverview() {
    void this.prisma;
    return {
      totalSchools: 0,
      totalStudents: 0,
      totalSubscriptionRevenueKobo: 0,
      totalMarketplaceCommissionKobo: 0,
      pendingWithdrawalsCount: 0,
    };
  }
}
