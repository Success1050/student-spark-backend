import { Body, Controller, Post } from '@nestjs/common';
import { NoteSummarizerService } from './services/note-summarizer.service.js';
import { StudyPlanAiService } from './services/study-plan-ai.service.js';
import { QuizGeneratorAiService } from './services/quiz-generator-ai.service.js';
import { PqPredictorAiService } from './services/pq-predictor-ai.service.js';
import { MotivationAiService } from './services/motivation-ai.service.js';
import { AiTutorService } from './services/ai-tutor.service.js';
import {
  AiTutorChatDto,
  GenerateMotivationAiDto,
  GeneratePqFromNotesAiDto,
  GenerateQuizFromNoteAiDto,
  GenerateStudyPlanAiDto,
  UploadNoteAiDto,
  UploadPastQuestionAiDto,
} from './dto/ai-requests.dto.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

/**
 * Preserves 100% route compatibility with studentspark_backend/server.js (/api/*)
 */
@Controller('api')
export class AiController {
  constructor(
    private readonly noteSummarizer: NoteSummarizerService,
    private readonly studyPlanAi: StudyPlanAiService,
    private readonly quizGeneratorAi: QuizGeneratorAiService,
    private readonly memoryMatchOrPqPredictorAi: PqPredictorAiService,
    private readonly motivationAi: MotivationAiService,
    private readonly aiTutor: AiTutorService,
  ) {}

  @Post('upload-note')
  async uploadAndSummarizeNote(
    @Body() dto: UploadNoteAiDto,
    @UserId() userId: string,
  ) {
    const finalUserId = userId || dto.userId;
    const fileBuffer = Buffer.from(dto.file || '', 'base64');
    return this.noteSummarizer.uploadAndSummarizeNote({
      userId: finalUserId,
      title: dto.title,
      fileBuffer,
      mimeType: dto.mimeType,
    });
  }

  @Post('study-plan')
  async generateStudyPlan(
    @Body() dto: GenerateStudyPlanAiDto,
    @UserId() userId: string,
  ) {
    const finalUserId = userId || dto.userId;
    const parsedHours =
      typeof dto.hours === 'number'
        ? dto.hours
        : typeof dto.studyHours === 'string'
          ? parseInt(dto.studyHours.split('-')[0], 10) || 4
          : Number(dto.studyHours) || 4;

    return this.studyPlanAi.generateStudyPlanFromNotes({
      userId: finalUserId,
      examDate: dto.examDate,
      planName: dto.planName,
      durationDays: Number(dto.duration) || 14,
      studyHoursRange: String(dto.studyHours || dto.hours || '4-5'),
      hoursPerDay: parsedHours,
      subjects: dto.subjects,
      noteIds: dto.noteIds || dto.notes,
      aiOptions: dto.aiOptions,
    });
  }

  @Post('upload-notes-for-pq')
  async generatePqFromNotes(
    @Body() dto: GeneratePqFromNotesAiDto,
    @UserId() userId: string,
  ) {
    const finalUserId = userId || dto.userId;
    return this.memoryMatchOrPqPredictorAi.generatePracticeQuestionsFromNotes(
      dto.noteIds,
      finalUserId,
    );
  }

  @Post('upload-notes-for-quiz')
  async generateQuizFromNote(
    @Body() dto: GenerateQuizFromNoteAiDto,
    @UserId() userId: string,
  ) {
    const finalUserId = userId || dto.userId;
    return this.quizGeneratorAi.generateQuizFromNote(dto.noteId, finalUserId);
  }

  @Post('upload-past-question')
  async uploadAndAnalyzePastQuestion(
    @Body() dto: UploadPastQuestionAiDto,
    @UserId() userId: string,
  ) {
    const finalUserId = userId || dto.userId;
    const fileBuffer = Buffer.from(dto.file || '', 'base64');
    return this.memoryMatchOrPqPredictorAi.uploadAndAnalyzePastQuestionPdf({
      userId: finalUserId,
      title: dto.title,
      fileBuffer,
    });
  }

  @Post('motivation-gen')
  async generateMotivation(
    @Body() dto: GenerateMotivationAiDto,
    @UserId() userId: string,
  ) {
    const finalUserId = userId || dto.userId;
    const motivation = await this.motivationAi.generateDailyMotivation(finalUserId);
    return { message: 'Motivation generated and saved successfully', motivation };
  }

  @Post('ai/tutor-chat')
  async chatWithAiTutor(
    @Body() dto: AiTutorChatDto,
    @UserId() userId: string,
  ) {
    return this.aiTutor.chatWithTutor({
      ...dto,
      userId: userId || dto.userId,
    });
  }

  @Post('tutor-chat')
  async chatWithAiTutorAlias(
    @Body() dto: AiTutorChatDto,
    @UserId() userId: string,
  ) {
    return this.aiTutor.chatWithTutor({
      ...dto,
      userId: userId || dto.userId,
    });
  }
}
