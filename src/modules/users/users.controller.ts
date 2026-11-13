import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  getProfile(@Param('id') id: string, @UserId() userId: string) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.getProfile(finalId);
  }

  @Patch(':id')
  updateProfile(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UserId() userId: string,
  ) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.updateProfile(finalId, body);
  }

  @Get(':id/streak')
  getStreak(@Param('id') id: string, @UserId() userId: string) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.getStreak(finalId);
  }

  @Post(':id/streak')
  updateStreak(@Param('id') id: string, @UserId() userId: string) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.updateStreak(finalId);
  }

  @Get(':id/courses')
  getCourses(@Param('id') id: string, @UserId() userId: string) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.getUserCourses(finalId);
  }

  @Post(':id/courses')
  addCourse(
    @Param('id') id: string,
    @Body() body: { courseCode: string; color: string },
    @UserId() userId: string,
  ) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.addUserCourse(finalId, body.courseCode, body.color);
  }

  @Delete(':id/courses/:courseId')
  deleteCourse(
    @Param('id') id: string,
    @Param('courseId') courseId: string,
    @UserId() userId: string,
  ) {
    const finalId = !id || id === 'me' ? userId : id;
    return this.usersService.deleteUserCourse(courseId, finalId);
  }
}
