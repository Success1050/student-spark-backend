import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { OpenAiService } from './openai.service.js';
import { DrmWatermarkService } from '../../marketplace/drm/drm-watermark.service.js';
import { AiTutorChatDto } from '../dto/ai-requests.dto.js';

export interface AiTutorResponse {
  answer: string;
  suggestedFollowUps: string[];
  referenceContext: {
    type: 'NOTE' | 'BOOK_CHAPTER' | 'CUSTOM';
    title: string;
    courseCode?: string;
    chapterTitle?: string;
  };
}

@Injectable()
export class AiTutorService {
  private readonly logger = new Logger(AiTutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openAi: OpenAiService,
    private readonly drmService: DrmWatermarkService,
  ) {}

  async chatWithTutor(dto: AiTutorChatDto): Promise<AiTutorResponse> {
    let contextTitle = 'General Study Material';
    let contextType: 'NOTE' | 'BOOK_CHAPTER' | 'CUSTOM' = 'CUSTOM';
    let courseCode = '';
    let chapterTitle: string | undefined;
    let materialBody = '';

    // 1. Resolve Note Context
    if (dto.noteId) {
      const note = await this.prisma.note.findUnique({
        where: { id: dto.noteId },
      });
      if (note) {
        contextType = 'NOTE';
        contextTitle = note.title;
        courseCode = note.courseCode;

        let topicsSummary = '';
        if (Array.isArray(note.listsOfTopic)) {
          topicsSummary = (note.listsOfTopic as any[])
            .map((t, idx) => `Topic ${idx + 1}: ${t.topic || ''} - ${t.explanation || ''}`)
            .join('\n');
        }

        materialBody = [
          `Note Title: ${note.title}`,
          `Course / Subject Code: ${note.courseCode}`,
          `AI Summary:\n${note.summary}`,
          `Detailed Topics & Explanations:\n${topicsSummary}`,
        ].join('\n\n');
      }
    }
    // 2. Resolve Book Context
    else if (dto.bookId) {
      const book = await this.prisma.marketplaceItem.findUnique({
        where: { id: dto.bookId },
      });
      if (book) {
        contextType = 'BOOK_CHAPTER';
        contextTitle = book.title;
        courseCode = book.courseCode;

        const chapters = this.drmService.generateStructuredChapters({
          ...book,
          authorName: book.authorName || 'Academic Educator',
        });
        const targetChapter =
          typeof dto.chapterNumber === 'number'
            ? chapters.find((c) => c.chapterNumber === dto.chapterNumber) || chapters[0]
            : chapters[0];

        chapterTitle = targetChapter ? `Chapter ${targetChapter.chapterNumber}: ${targetChapter.title}` : undefined;

        materialBody = [
          `Textbook Title: ${book.title}`,
          `Author: ${book.authorName || 'Academic Educator'}`,
          `Course Code: ${book.courseCode}`,
          `Description: ${book.description}`,
          chapterTitle ? `Active Chapter: ${chapterTitle}` : '',
          targetChapter ? `Chapter Summary: ${targetChapter.summary}` : '',
          targetChapter ? `Chapter Core Content:\n${targetChapter.content}` : '',
          targetChapter?.keyPoints ? `Key Points:\n- ${targetChapter.keyPoints.join('\n- ')}` : '',
        ].filter(Boolean).join('\n\n');
      }
    }

    if (dto.contextText?.trim()) {
      materialBody += `\n\nAdditional Student Context / Selected Passage:\n${dto.contextText.trim()}`;
    }

    if (!materialBody.trim()) {
      materialBody = 'General Academic Query across Nigerian University, Polytechnic, and Secondary Curriculum.';
    }

    // 2. Persona / Pedagogy by Mode
    const mode = dto.mode || 'GENERAL';
    let modeGuidance = '';
    switch (mode) {
      case 'EXPLAIN_SIMPLE':
        modeGuidance =
          'Explain the concept with maximum clarity, using intuitive analogies, everyday relatable examples (with Nigerian/African contextual anchors where helpful), and simple language without condescension.';
        break;
      case 'DEEP_DIVE':
        modeGuidance =
          'Provide a thorough, comprehensive academic breakdown. Include theoretical derivations, architectural principles, step-by-step logic, and exact mathematical or scientific notations where applicable.';
        break;
      case 'TEST_ME':
        modeGuidance =
          'Act as an encouraging examiner. If the user answered a question, evaluate their answer with constructive praise and specific corrections. If the user asks to be tested, provide 2 crisp conceptual questions with a hint.';
        break;
      case 'EXAM_TIPS':
        modeGuidance =
          'Highlight high-yield exam patterns, typical marking scheme expectations, common examiner traps, memory acronyms, and formulas essential for scoring full marks.';
        break;
      default:
        modeGuidance =
          'Provide a balanced, structured, and pedagogical response. Encourage the student and guide their critical thinking.';
        break;
    }

    // 3. System Prompt
    const systemPrompt = [
      `You are Spark AI Tutor, a brilliant, friendly, and pedagogically gifted academic tutor for StudentSpark (an education ecosystem for universities, polytechnics, and secondary schools).`,
      `Your primary goal is to help students truly master their coursework, ace tests, and build deep understanding.`,
      `STUDY MATERIAL CONTEXT:\n${materialBody.substring(0, 15000)}`,
      `TUTOR MODE INSTRUCTION (${mode}):\n${modeGuidance}`,
      `GUIDELINES:`,
      `1. Format using clean GitHub-style Markdown (bullet points, bold highlights, code blocks, clean KaTeX-ready math).`,
      `2. Directly address the student's question before elaborating. Ground your explanation in the study material above whenever possible.`,
      `3. Always end your response with exactly three insightful follow-up questions the student can ask next, formatted inside a triple-backtick json block at the very end as:`,
      `\`\`\`json`,
      `{"suggestedFollowUps": ["Question 1?", "Question 2?", "Question 3?"]}`,
      `\`\`\``,
    ].join('\n\n');

    // 4. Construct messages with chat history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (dto.chatHistory && Array.isArray(dto.chatHistory)) {
      // Include last 6 turns to avoid context overflow
      const recentHistory = dto.chatHistory.slice(-6);
      for (const msg of recentHistory) {
        if (msg.content?.trim()) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content.trim(),
          });
        }
      }
    }

    messages.push({
      role: 'user',
      content: dto.question.trim(),
    });

    try {
      const response = await this.openAi.getClient().chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: messages as any,
        temperature: 0.6,
        max_tokens: 1200,
      });

      const rawContent = response.choices[0]?.message?.content?.trim() || '';

      // Extract JSON suggestedFollowUps if present
      let answer = rawContent;
      let suggestedFollowUps: string[] = [];

      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed.suggestedFollowUps)) {
            suggestedFollowUps = parsed.suggestedFollowUps.map((q: any) => String(q).trim()).filter(Boolean);
          }
          // Remove the json block from the answer visible to the user
          answer = rawContent.replace(jsonMatch[0], '').trim();
        } catch {
          // ignore parsing error
        }
      }

      if (suggestedFollowUps.length === 0) {
        suggestedFollowUps = [
          'Can you explain this with another practical example?',
          'What are the most common exam questions on this?',
          'Can you test me on this concept?',
        ];
      }

      return {
        answer,
        suggestedFollowUps,
        referenceContext: {
          type: contextType,
          title: contextTitle,
          courseCode: courseCode || undefined,
          chapterTitle,
        },
      };
    } catch (err: any) {
      this.logger.error('Failed to generate AI tutor response', err);
      return {
        answer: `I had a temporary hiccup communicating with the AI service (${err?.message || 'Network error'}). Please try again in a moment!`,
        suggestedFollowUps: [
          'Can you retry explaining this?',
          'What is the core idea of this note?',
        ],
        referenceContext: {
          type: contextType,
          title: contextTitle,
          courseCode: courseCode || undefined,
          chapterTitle,
        },
      };
    }
  }
}
