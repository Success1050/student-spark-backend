import { Controller, Delete, Get, Param } from '@nestjs/common';
import { NotesService } from './notes.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  findAll(@UserId() userId: string) {
    return this.notesService.findAllByUser(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notesService.findOneById(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notesService.deleteNote(id);
  }
}
