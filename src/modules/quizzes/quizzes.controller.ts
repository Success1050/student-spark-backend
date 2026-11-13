import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { QuizzesService } from './quizzes.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get()
  findAll(@UserId() userId: string) {
    return this.quizzesService.findAllByUser(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quizzesService.findOneById(id);
  }

  @Patch(':id/score')
  updateScore(
    @Param('id') id: string,
    @Body()
    body: {
      percentage: number;
      totalMarks: number;
      totalPossibleMarks: number;
      correctCount: number;
    },
  ) {
    return this.quizzesService.updateQuizScore(id, body);
  }
}
