import { Module } from '@nestjs/common';
import { CourseRepController } from './course-rep.controller.js';
import { CourseRepService } from './course-rep.service.js';

@Module({
  controllers: [CourseRepController],
  providers: [CourseRepService],
  exports: [CourseRepService],
})
export class CourseRepModule {}
