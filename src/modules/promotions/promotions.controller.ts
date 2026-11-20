import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  ExecuteClassPromotionDto,
  ExecuteSchoolRolloverDto,
  TeacherConfirmPromotionDto,
} from './dto/promotions.dto.js';
import { PromotionsService } from './promotions.service.js';

@Controller(['promotions', 'api/promotions'])
@UseGuards(RolesGuard)
export class PromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveContext(
    userId: string,
    explicitSchoolId?: string,
  ): Promise<{ schoolId: string; role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { schoolId: true, role: true },
    });
    const schoolId = explicitSchoolId || user?.schoolId;
    if (!schoolId) {
      throw new BadRequestException('User is not assigned to an active institution.');
    }
    return { schoolId, role: user?.role || 'STUDENT' };
  }

  @Get('overview')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER')
  async getOverview(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('passMarkPercent') passMarkPercent?: string,
    @Query('trialMarkPercent') trialMarkPercent?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.getPromotionOverview(ctx.schoolId, userId, ctx.role, {
      sessionId,
      passMarkPercent: passMarkPercent ? Number(passMarkPercent) : undefined,
      trialMarkPercent: trialMarkPercent ? Number(trialMarkPercent) : undefined,
    });
  }

  @Get('classes/:classId/preview')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER')
  async getClassPreview(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Query('schoolId') schoolId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('passMarkPercent') passMarkPercent?: string,
    @Query('trialMarkPercent') trialMarkPercent?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.getClassPromotionPreview(ctx.schoolId, classId, {
      sessionId,
      passMarkPercent: passMarkPercent ? Number(passMarkPercent) : undefined,
      trialMarkPercent: trialMarkPercent ? Number(trialMarkPercent) : undefined,
    });
  }

  @Post('classes/:classId/teacher-confirm')
  @Roles('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('PROMOTION_CLASS_CONFIRMED', 'PromotionClassReview')
  async confirmClassByTeacher(
    @UserId() userId: string,
    @Param('classId') classId: string,
    @Body() dto: TeacherConfirmPromotionDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.confirmClassByTeacher(
      ctx.schoolId,
      classId,
      userId,
      ctx.role,
      dto,
    );
  }

  @Post('execute-class')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('CLASS_PROMOTION_EXECUTED', 'PromotionBatch')
  async executeClassPromotion(
    @UserId() userId: string,
    @Body() dto: ExecuteClassPromotionDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.executeClassPromotion(ctx.schoolId, userId, ctx.role, dto);
  }

  @Post('execute-school-rollover')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('SCHOOL_WIDE_ROLLOVER_EXECUTED', 'PromotionBatch')
  async executeSchoolRollover(
    @UserId() userId: string,
    @Body() dto: ExecuteSchoolRolloverDto,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.executeSchoolWideRollover(ctx.schoolId, userId, ctx.role, dto);
  }

  @Get('batches')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  async getBatches(
    @UserId() userId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.getPromotionBatches(ctx.schoolId);
  }

  @Post('batches/:batchId/undo')
  @Roles('SCHOOL_ADMIN', 'SUPER_ADMIN')
  @AuditAction('PROMOTION_BATCH_UNDONE', 'PromotionBatch')
  async undoBatch(
    @UserId() userId: string,
    @Param('batchId') batchId: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const ctx = await this.resolveContext(userId, schoolId);
    return this.promotionsService.undoPromotionBatch(ctx.schoolId, batchId, userId, ctx.role);
  }
}
