import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Handles daily/weekly/monthly study hours tracking, manual session logs, and streaks
 */
@Injectable()
export class TrackerService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudyStats(userId: string) {
    void this.prisma;
    return {
      userId,
      streak: 0,
      todayHours: 0,
      weeklyHours: [0, 0, 0, 0, 0, 0, 0],
      monthlyHours: [0, 0, 0, 0],
    };
  }
}
