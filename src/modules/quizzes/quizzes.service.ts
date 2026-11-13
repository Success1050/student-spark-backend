import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Replaces Supabase 'quizzes' table queries (getAllQuizzes, getspecificQuiz, getUserQuizData)
 */
@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  private formatQuiz(quiz: {
    id: string;
    userId: string;
    noteId: string | null;
    title: string;
    courseCode: string;
    color: string;
    questions: unknown;
    score: number;
    percentage: number;
    totalMarks: number;
    totalPossibleMarks: number;
    correctCount: number;
    completed: boolean;
    timeLimit: number;
    createdAt: Date;
  }) {
    return {
      ...quiz,
      user_id: quiz.userId,
      note_id: quiz.noteId,
      course_code: quiz.courseCode,
      quiz_data: quiz.questions,
      time_limit: quiz.timeLimit,
      created_at: quiz.createdAt.toISOString(),
    };
  }

  async findAllByUser(userId: string) {
    if (!userId) return [];
    const quizzes = await this.prisma.quiz.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return quizzes.map((q) => this.formatQuiz(q));
  }

  async findOneById(quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: String(quizId) },
    });
    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }
    return this.formatQuiz(quiz);
  }

  async updateQuizScore(
    quizId: string,
    payload: {
      percentage: number;
      totalMarks: number;
      totalPossibleMarks: number;
      correctCount: number;
    },
  ) {
    const updated = await this.prisma.quiz.update({
      where: { id: String(quizId) },
      data: {
        percentage: Number(payload.percentage) || 0,
        score: Number(payload.percentage) || 0,
        totalMarks: Number(payload.totalMarks) || 0,
        totalPossibleMarks: Number(payload.totalPossibleMarks) || 10,
        correctCount: Number(payload.correctCount) || 0,
        completed: true,
      },
    });
    return this.formatQuiz(updated);
  }
}
