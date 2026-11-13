import { Controller, Get } from '@nestjs/common';
import { TrackerService } from './tracker.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('tracker')
export class TrackerController {
  constructor(private readonly trackerService: TrackerService) {}

  @Get('stats')
  getStats(@UserId() userId: string) {
    return this.trackerService.getStudyStats(userId);
  }
}
