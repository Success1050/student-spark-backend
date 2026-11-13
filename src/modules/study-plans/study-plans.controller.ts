import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { StudyPlansService } from './study-plans.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('study-plans')
export class StudyPlansController {
  constructor(private readonly studyPlansService: StudyPlansService) {}

  @Get()
  findAll(@UserId() userId: string) {
    return this.studyPlansService.findAllByUser(userId);
  }

  @Get('active')
  getActive(@UserId() userId: string) {
    return this.studyPlansService.findAllByUser(userId);
  }

  @Patch(':planId/tasks')
  updateCompletedTasks(
    @Param('planId') planId: string,
    @Body() body: { userId?: string; completedTaskIds?: string[] },
    @UserId() userId: string,
  ) {
    return this.studyPlansService.updateCompletedTasks(
      planId,
      userId || body.userId || '',
      body.completedTaskIds || [],
    );
  }
}
