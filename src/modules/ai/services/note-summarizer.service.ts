import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { UsageTrackingService } from '../../usage-tracking/usage-tracking.service.js';
import { getRandomColor } from '../../../common/utils/helpers.util.js';
import { OpenAiService } from './openai.service.js';
import { PdfParserService } from './pdf-parser.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

export interface TopicItem {
  id: number;
  topic: string;
  title: string;
  explanation: string;
}

export interface ChunkSummaryResult {
  summary: string;
  course_code: string;
  lists_of_topic: TopicItem[];
}

/**
 * Merged from studentspark_backend/AIRoutes/uploadpdfRoute.js
 * Checks daily quota, uploads PDF/image to storage, extracts/OCRs text, summarizes in 30k-char chunks,
 * saves Note in Prisma, records usage, and performs atomic rollback on failure.
 */
@Injectable()
export class NoteSummarizerService {
  private readonly logger = new Logger(NoteSummarizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usageTracking: UsageTrackingService,
    private readonly openAiService: OpenAiService,
    private readonly pdfParserService: PdfParserService,
    private readonly notifications: NotificationsService,
  ) {}

  async uploadAndSummarizeNote(params: {
    userId: string;
    title: string;
    fileBuffer: Buffer;
    mimeType?: string;
    schoolId?: string;
    classId?: string;
    subjectId?: string;
  }) {
    const { userId, title, fileBuffer, mimeType, schoolId, classId, subjectId } = params;

    if (!fileBuffer?.byteLength || !title || !userId) {
      throw new BadRequestException('Missing fields (file, title, userId)');
    }

    await this.usageTracking.verifyQuota(userId, 'note_upload');

    let uploadedFilePath: string | null = null;
    let createdNoteId: string | null = null;
    let usageRecordId: string | null = null;

    try {
      const isImage = Boolean(mimeType && mimeType.startsWith('image/'));
      const ext = isImage ? '.jpg' : '.pdf';
      const fileName = `${randomUUID()}_${title.replace(/[^a-zA-Z0-9._-]/g, '_')}${ext}`;
      const uploaded = await this.storage.uploadPdfBuffer(fileBuffer, fileName, 'notes');
      uploadedFilePath = uploaded.filePath;

      let extractedText = '';
      if (isImage) {
        const base64Img = fileBuffer.toString('base64');
        extractedText = await this.openAiService.extractTextFromImageBatch([base64Img]);
      } else {
        extractedText = await this.pdfParserService.extractTextFromPdfBuffer(fileBuffer);
      }

      if (!extractedText || !extractedText.trim()) {
        throw new BadRequestException('Could not extract readable text from document');
      }

      const txtChunks = this.openAiService.splitTextIntoChunks(extractedText, 30000);
      this.logger.log(`Note text split into ${txtChunks.length} chunk(s)`);

      const partialSummaries: ChunkSummaryResult[] = [];

      for (let i = 0; i < txtChunks.length; i++) {
        this.logger.log(`Summarizing chunk ${i + 1}/${txtChunks.length}...`);
        const raw = await this.openAiService.chatCompletion({
          systemPrompt: `You are an expert educational content summarizer.
You are analyzing PART ${i + 1} of ${txtChunks.length} of a student's note.
Read the provided note text and produce a clear, comprehensive, well-structured Markdown summary with headings, subheadings, bullet points, and examples.

Return ONLY valid JSON in this exact format:
{
  "summary": "Markdown summary text...",
  "course_code": "Course code or subject name (e.g., CSC 201)",
  "lists_of_topic": [
    {
      "id": 1,
      "topic": "Topic Name",
      "title": "Topic Name",
      "explanation": "Clear explanation of this key topic for exam revision"
    }
  ]
}`,
          userPrompt: `Summarize this part of the note clearly:\n\n${txtChunks[i]}`,
        });

        const parsed = this.openAiService.cleanJsonOutput<ChunkSummaryResult>(raw, {
          summary: raw,
          course_code: 'General',
          lists_of_topic: [],
        });
        partialSummaries.push(parsed);
      }

      const mergedTopics: TopicItem[] = [];
      const seenTopics = new Set<string>();
      for (const part of partialSummaries) {
        for (const item of part.lists_of_topic || []) {
          const topicObj =
            typeof item === 'string'
              ? {
                  id: mergedTopics.length + 1,
                  topic: item,
                  title: item,
                  explanation: '',
                }
              : {
                  id: mergedTopics.length + 1,
                  topic: item.topic || item.title || `Topic ${mergedTopics.length + 1}`,
                  title: item.title || item.topic || `Topic ${mergedTopics.length + 1}`,
                  explanation: item.explanation || '',
                };
          const key = topicObj.topic.toLowerCase();
          if (!seenTopics.has(key)) {
            seenTopics.add(key);
            mergedTopics.push(topicObj);
          }
        }
      }

      const finalResult: ChunkSummaryResult = {
        summary: partialSummaries.map((p) => p.summary).join('\n\n---\n\n'),
        course_code:
          partialSummaries.find(
            (p) => p.course_code && p.course_code !== 'General',
          )?.course_code || 'General',
        lists_of_topic: mergedTopics,
      };

      const savedNote = await this.prisma.note.create({
        data: {
          userId,
          schoolId: schoolId || null,
          classId: classId || null,
          subjectId: subjectId || null,
          title,
          summary: finalResult.summary,
          courseCode: finalResult.course_code || 'General',
          color: getRandomColor(),
          listsOfTopic: finalResult.lists_of_topic as unknown as object,
          fileUrl: uploaded.publicUrl,
          isClassNote: Boolean(classId),
        },
      });
      createdNoteId = savedNote.id;

      usageRecordId = await this.usageTracking.recordUsage(userId, 'note_upload');

      void this.notifications.dispatchNotification({
        userId,
        title: `✨ AI Summary Ready: ${title}`,
        body: `Your note "${title}" (${finalResult.course_code || 'General'}) has been summarized with ${finalResult.lists_of_topic.length} key exam topics.`,
        category: 'STUDY',
        deepLink: `/notesDetails?id=${savedNote.id}`,
        channels: { inApp: true, push: true, email: false },
      });

      return {
        message: 'Uploaded & summarized successfully',
        note: {
          ...savedNote,
          user_id: savedNote.userId,
          course_code: savedNote.courseCode,
          file_url: savedNote.fileUrl,
          ai_summary: savedNote.summary,
          lists_of_topic: finalResult.lists_of_topic,
          created_at: savedNote.createdAt.toISOString(),
        },
        summary: finalResult,
      };
    } catch (error) {
      this.logger.error('Upload note failed, executing atomic rollback', error);
      if (createdNoteId) {
        await this.prisma.note.delete({ where: { id: createdNoteId } }).catch(() => undefined);
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
