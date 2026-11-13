import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { UsageTrackingService } from '../../usage-tracking/usage-tracking.service.js';
import { getRandomColor } from '../../../common/utils/helpers.util.js';
import { OpenAiService } from './openai.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

export interface GeneratedQuizQuestionItem {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  marks: number;
}

export interface GeneratedQuizPayload {
  quiz_metadata: {
    difficulty: string;
    note_title: string;
    time_limit: number;
    course_code: string;
    topics_covered: string[];
    total_questions: number;
  };
  questions: GeneratedQuizQuestionItem[];
  study_tips: string[];
}

/**
 * Merged from studentspark_backend/AIRoutes/uploadNotesForQuizGeneration.js
 * Generates 10 MCQ quiz questions with options, correct_answer, explanation, study_tips, and quiz_metadata.
 */
@Injectable()
export class QuizGeneratorAiService {
  private readonly logger = new Logger(QuizGeneratorAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageTracking: UsageTrackingService,
    private readonly openAiService: OpenAiService,
    private readonly notifications: NotificationsService,
  ) {}

  async generateQuizFromNote(noteId: string, userId: string) {
    if (!noteId || !userId) {
      throw new BadRequestException('noteId and userId are required');
    }

    await this.usageTracking.verifyQuota(userId, 'quiz_generate');

    const note = await this.prisma.note.findUnique({ where: { id: String(noteId) } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    let createdQuizId: string | null = null;
    let usageRecordId: string | null = null;

    try {
      const raw = await this.openAiService.chatCompletion({
        systemPrompt: `You are an expert university examiner.
Generate a 10-question multiple-choice quiz based strictly on the provided note summary.
 Note: time_limit MUST be in seconds (e.g., 600 for 10 minutes).
Return ONLY valid JSON in this exact format:
{
  "quiz_metadata": {
    "difficulty": "Medium",
    "note_title": "${note.title}",
    "time_limit": 600,
    "course_code": "${note.courseCode || 'General'}",
    "topics_covered": ["Topic 1", "Topic 2"],
    "total_questions": 10
  },
  "questions": [
    {
      "question_number": 1,
      "question": "Question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "Exact text of the correct option",
      "explanation": "Brief explanation of why this answer is correct",
      "topic": "Specific topic name",
      "difficulty": "medium",
      "marks": 1
    }
  ],
  "study_tips": [
    "Review key definitions before attempting timed exams.",
    "Focus on topics where you took longer to answer."
  ]
}`,
        userPrompt: `Course: ${note.courseCode}\nTitle: ${note.title}\nContent:\n${note.summary.slice(0, 25000)}`,
      });

      const parsed = this.openAiService.cleanJsonOutput<GeneratedQuizPayload>(raw, {
        quiz_metadata: {
          difficulty: 'Medium',
          note_title: note.title,
          time_limit: 600,
          course_code: note.courseCode || 'General',
          topics_covered: [],
          total_questions: 0,
        },
        questions: [],
        study_tips: [],
      });

      if (!parsed.questions?.length) {
        throw new BadRequestException('Failed to generate quiz questions from note');
      }

      parsed.quiz_metadata = {
        difficulty: parsed.quiz_metadata?.difficulty || 'Medium',
        note_title: parsed.quiz_metadata?.note_title || note.title,
        time_limit: Number(parsed.quiz_metadata?.time_limit) || 600,
        course_code: parsed.quiz_metadata?.course_code || note.courseCode || 'General',
        topics_covered: parsed.quiz_metadata?.topics_covered || [],
        total_questions: parsed.questions.length,
      };

      const savedQuiz = await this.prisma.quiz.create({
        data: {
          userId,
          noteId: note.id,
          schoolId: note.schoolId,
          classId: note.classId,
          subjectId: note.subjectId,
          title: `${note.title} Quiz`,
          courseCode: parsed.quiz_metadata.course_code,
          color: getRandomColor(),
          questions: parsed as unknown as object,
          score: 0,
          percentage: 0,
          totalMarks: 0,
          totalPossibleMarks: parsed.questions.reduce((acc, q) => acc + (Number(q.marks) || 1), 0),
          correctCount: 0,
          completed: false,
          timeLimit: parsed.quiz_metadata.time_limit,
        },
      });
      createdQuizId = savedQuiz.id;

      usageRecordId = await this.usageTracking.recordUsage(userId, 'quiz_generate');

      void this.notifications.dispatchNotification({
        userId,
        title: `🧠 New AI Quiz Ready: ${savedQuiz.title}`,
        body: `${parsed.questions.length} multiple-choice questions generated from "${note.title}". Tap to test your knowledge!`,
        category: 'STUDY',
        deepLink: `/quizDetails?quizId=${savedQuiz.id}`,
        channels: { inApp: true, push: true, email: false },
      });

      return {
        message: 'Quiz generated and saved successfully',
        quiz: {
          ...savedQuiz,
          user_id: savedQuiz.userId,
          note_id: savedQuiz.noteId,
          course_code: savedQuiz.courseCode,
          quiz_data: parsed,
          created_at: savedQuiz.createdAt.toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Quiz generation failed, rolling back', error);
      if (createdQuizId) {
        await this.prisma.quiz.delete({ where: { id: createdQuizId } }).catch(() => undefined);
      }
      if (usageRecordId) {
        await this.usageTracking.rollbackUsage(usageRecordId);
      }
      throw error;
    }
  }
}
