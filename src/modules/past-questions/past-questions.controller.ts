import { Controller, Get, Param } from '@nestjs/common';
import { PastQuestionsService } from './past-questions.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('past-questions')
export class PastQuestionsController {
  constructor(private readonly pastQuestionsService: PastQuestionsService) {}

  @Get('practice-sets')
  findPracticeSets(@UserId() userId: string) {
    return this.pastQuestionsService.findPracticeSetsByUser(userId);
  }

  @Get('practice-sets/:id')
  findOnePracticeSet(
    @Param('id') id: string,
    @UserId() userId?: string,
  ) {
    return this.pastQuestionsService.findOnePracticeSet(id, userId);
  }

  @Get()
  findAll(@UserId() userId: string) {
    return this.pastQuestionsService.findAllByUser(userId);
  }
}
