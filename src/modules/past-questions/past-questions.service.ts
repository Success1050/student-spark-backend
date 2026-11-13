import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Replaces Supabase 'practice_question_sets', 'past_questions', and 'past_question_topics' queries
 * (getGenPqs, getThePQS)
 */
@Injectable()
export class PastQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  private formatPracticeSet(set: {
    id: string;
    userId: string;
    noteId: string | null;
    noteIds: string[];
    title: string;
    courseCode: string;
    totalQuestions: number;
    questions: unknown;
    completed: boolean;
    score: number | null;
    totalAttempted: number;
    createdAt: Date;
  }) {
    return {
      ...set,
      user_id: set.userId,
      note_id: set.noteId,
      note_ids: set.noteIds,
      course_code: set.courseCode,
      total_questions: set.totalQuestions,
      questions_data: set.questions,
      total_attempted: set.totalAttempted,
      created_at: set.createdAt.toISOString(),
    };
  }

  async findPracticeSetsByUser(userId: string) {
    if (!userId) return [];
    const sets = await this.prisma.practiceQuestionSet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return sets.map((s) => this.formatPracticeSet(s));
  }

  async findOnePracticeSet(setId: string, userId?: string) {
    const set = await this.prisma.practiceQuestionSet.findFirst({
      where: {
        id: String(setId),
        ...(userId ? { userId } : {}),
      },
    });
    if (!set) {
      throw new NotFoundException('Practice question set not found');
    }
    return this.formatPracticeSet(set);
  }

  async findAllByUser(userId: string) {
    if (!userId) return [];
    const pastQuestions = await this.prisma.pastQuestion.findMany({
      where: { userId },
      include: { topics: true },
      orderBy: { createdAt: 'desc' },
    });
    return pastQuestions.map((pq) => ({
      ...pq,
      user_id: pq.userId,
      file_url: pq.fileUrl,
      past_question_topics: pq.topics,
      created_at: pq.createdAt.toISOString(),
    }));
  }
}
