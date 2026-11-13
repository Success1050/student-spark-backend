import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { UsageTrackingService } from '../../usage-tracking/usage-tracking.service.js';
import { OpenAiService } from './openai.service.js';
import { PdfParserService } from './pdf-parser.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

export interface PracticeQuestionPayload {
  metadata: {
    total_subjects: number;
    total_questions: number;
    generation_date: string;
    difficulty_distribution: {
      easy: number;
      medium: number;
      hard: number;
    };
  };
  subjects: Array<{
    subject_name: string;
    note_title: string;
    total_questions: number;
    questions: Array<{
      id: string;
      question_number: number;
      topic: string;
      question_type: string;
      difficulty: string;
      question: string;
      answer: string;
      marks: number;
      bloom_level: string;
      attempted: boolean;
      user_answer: string | null;
    }>;
  }>;
  study_tips: string[];
}

export interface PastQuestionAnalysisChunk {
  subject: string;
  year: string;
  topics: Array<{ name: string; probability: number }>;
  analyzed: boolean;
}

/**
 * Merged from:
 * 1. studentspark_backend/AIRoutes/uploadnotesforpqprediction.js (Bloom's taxonomy practice questions)
 * 2. studentspark_backend/AIRoutes/uploadPasrQuestionss.js (Past Question PDF topic probability analyzer >= 50%)
 */
@Injectable()
export class PqPredictorAiService {
  private readonly logger = new Logger(PqPredictorAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usageTracking: UsageTrackingService,
    private readonly openAiService: OpenAiService,
    private readonly pdfParserService: PdfParserService,
    private readonly notifications: NotificationsService,
  ) {}

  async generatePracticeQuestionsFromNotes(noteIds: Array<string | number>, userId: string) {
    if (!noteIds?.length || !userId) {
      throw new BadRequestException('noteIds and userId are required');
    }

    await this.usageTracking.verifyQuota(userId, 'pq_generate');

    const stringNoteIds = noteIds.map(String);
    const notes = await this.prisma.note.findMany({
      where: { id: { in: stringNoteIds }, userId },
    });

    if (!notes.length) {
      throw new BadRequestException('No matching notes found');
    }

    const combinedSummary = notes
      .map((n) => `### Subject: ${n.courseCode || n.title}\n**${n.title}**\n${n.summary}`)
      .join('\n\n')
      .slice(0, 30000);

    const todayStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });

    let createdSetId: string | null = null;
    let usageRecordId: string | null = null;

    try {
      const raw = await this.openAiService.chatCompletion({
        systemPrompt: `You are an expert academic examiner using Bloom's Taxonomy.
Generate comprehensive exam practice questions with detailed answers based on the provided student notes (40% Easy, 40% Medium, 20% Hard).
Return ONLY valid JSON with this exact structure:
{
  "metadata": {
    "total_subjects": ${notes.length},
    "total_questions": 10,
    "generation_date": "${todayStr}",
    "difficulty_distribution": {
      "easy": 4,
      "medium": 4,
      "hard": 2
    }
  },
  "subjects": [
    {
      "subject_name": "Course code or title",
      "note_title": "Original note title",
      "total_questions": 10,
      "questions": [
        {
          "id": "q1_sub1",
          "question_number": 1,
          "topic": "Specific topic",
          "question_type": "Explanation",
          "difficulty": "Easy",
          "question": "Question text?",
          "answer": "Complete, detailed answer",
          "marks": 5,
          "bloom_level": "Understand",
          "attempted": false,
          "user_answer": null
        }
      ]
    }
  ],
  "study_tips": ["Tip 1", "Tip 2"]
}`,
        userPrompt: combinedSummary,
      });

      const parsed = this.openAiService.cleanJsonOutput<PracticeQuestionPayload>(raw, {
        metadata: {
          total_subjects: notes.length,
          total_questions: 0,
          generation_date: todayStr,
          difficulty_distribution: { easy: 0, medium: 0, hard: 0 },
        },
        subjects: [],
        study_tips: [],
      });

      const totalQuestions =
        parsed.metadata?.total_questions ||
        parsed.subjects.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

      const createdSet = await this.prisma.practiceQuestionSet.create({
        data: {
          userId,
          noteId: notes[0].id,
          noteIds: stringNoteIds,
          title: `${notes[0].title} Practice Questions`,
          courseCode: notes[0].courseCode || 'General',
          totalQuestions,
          questions: parsed as unknown as object,
          completed: false,
          score: null,
          totalAttempted: 0,
        },
      });
      createdSetId = createdSet.id;

      usageRecordId = await this.usageTracking.recordUsage(userId, 'pq_generate');

      void this.notifications.dispatchNotification({
        userId,
        title: `📝 Practice Questions Ready!`,
        body: `${totalQuestions} exam-style practice questions generated across ${notes.length} note(s).`,
        category: 'STUDY',
        deepLink: '/(main)/notesQuizes',
        channels: { inApp: true, push: true, email: false },
      });

      return {
        success: true,
        data: {
          ...createdSet,
          user_id: createdSet.userId,
          note_ids: createdSet.noteIds,
          total_questions: createdSet.totalQuestions,
          questions_data: createdSet.questions,
          total_attempted: createdSet.totalAttempted,
          created_at: createdSet.createdAt,
        },
        questionCount: totalQuestions,
      };
    } catch (error) {
      this.logger.error('Practice question generation failed, rolling back', error);
      if (createdSetId) {
        await this.prisma.practiceQuestionSet
          .delete({ where: { id: createdSetId } })
          .catch(() => undefined);
      }
      if (usageRecordId) {
        await this.usageTracking.rollbackUsage(usageRecordId);
      }
      throw error;
    }
  }

  async uploadAndAnalyzePastQuestionPdf(params: {
    userId: string;
    title: string;
    fileBuffer: Buffer;
    schoolId?: string;
  }) {
    const { userId, title, fileBuffer, schoolId } = params;

    if (!fileBuffer?.byteLength || !title || !userId) {
      throw new BadRequestException('Missing fields (file, title, userId)');
    }

    await this.usageTracking.verifyQuota(userId, 'past_question_upload');

    let uploadedFilePath: string | null = null;
    let createdPqId: string | null = null;
    let usageRecordId: string | null = null;

    try {
      const fileName = `${randomUUID()}_${title.replace(/\s+/g, '_')}.pdf`;
      const uploaded = await this.storage.uploadPdfBuffer(fileBuffer, fileName, 'past-questions');
      uploadedFilePath = uploaded.filePath;

      const pdfText = await this.pdfParserService.extractTextFromPdfBuffer(fileBuffer);
      if (!pdfText) {
        throw new BadRequestException('Could not extract text from Past Question PDF');
      }

      const txtChunks = this.openAiService.splitTextIntoChunks(pdfText, 30000);
      const partialAnalyses: PastQuestionAnalysisChunk[] = [];

      for (let i = 0; i < txtChunks.length; i++) {
        const raw = await this.openAiService.chatCompletion({
          systemPrompt: `You are an AI academic assistant specialized in analyzing past examination papers.
You are analyzing PART ${i + 1} of ${txtChunks.length} from a past question paper.
1. Extract the subject/course name and year from the document if available.
2. Identify all topics/concepts covered in the past questions.
3. For each topic, calculate a probability score (0-100%) indicating how likely it is to appear in future exams.
4. Only include topics with probability >= 50%.
5. Provide output strictly in JSON format:
{
  "subject": "Subject/Course name or course code",
  "year": "Exam year",
  "topics": [
    { "name": "Topic name", "probability": 85 }
  ],
  "analyzed": true
}`,
          userPrompt: `Analyze this past question paper part:\n\n${txtChunks[i]}`,
        });

        const parsed = this.openAiService.cleanJsonOutput<PastQuestionAnalysisChunk>(raw, {
          subject: 'Unknown Subject',
          year: 'Unknown Year',
          topics: [],
          analyzed: true,
        });
        partialAnalyses.push(parsed);
      }

      const subject =
        partialAnalyses.find((p) => p.subject && p.subject !== 'Unknown Subject')?.subject ||
        'Unknown Subject';
      const year =
        partialAnalyses.find((p) => p.year && p.year !== 'Unknown Year')?.year ||
        'Unknown Year';

      const allTopicsMap: Record<string, { name: string; probability: number }> = {};
      for (const part of partialAnalyses) {
        for (const t of part.topics || []) {
          const key = t.name.toLowerCase().trim();
          if (!allTopicsMap[key] || allTopicsMap[key].probability < t.probability) {
            allTopicsMap[key] = t;
          }
        }
      }

      const mergedTopics = Object.values(allTopicsMap).sort(
        (a, b) => b.probability - a.probability,
      );

      const savedPq = await this.prisma.pastQuestion.create({
        data: {
          userId,
          schoolId: schoolId || null,
          title,
          subject,
          year,
          fileUrl: uploaded.publicUrl,
          analyzed: true,
        },
      });
      createdPqId = savedPq.id;

      if (mergedTopics.length > 0) {
        await this.prisma.pastQuestionTopic.createMany({
          data: mergedTopics.map((topic) => ({
            pastQuestionId: savedPq.id,
            name: topic.name,
            probability: Number(topic.probability) || 50,
          })),
        });
      }

      usageRecordId = await this.usageTracking.recordUsage(userId, 'past_question_upload');

      return {
        success: true,
        message: 'Past question uploaded and analyzed successfully',
        data: {
          pastQuestion: savedPq,
          analysis: {
            subject,
            year,
            topics: mergedTopics,
            analyzed: true,
          },
        },
      };
    } catch (error) {
      this.logger.error('Past question analysis failed, rolling back', error);
      if (createdPqId) {
        await this.prisma.pastQuestionTopic
          .deleteMany({ where: { pastQuestionId: createdPqId } })
          .catch(() => undefined);
        await this.prisma.pastQuestion
          .delete({ where: { id: createdPqId } })
          .catch(() => undefined);
      }
      if (usageRecordId) {
        await this.usageTracking.rollbackUsage(usageRecordId);
      }
      if (uploadedFilePath) {
        await this.storage.deleteFile(uploadedFilePath);
      }
      throw error;
    }
  }
}
