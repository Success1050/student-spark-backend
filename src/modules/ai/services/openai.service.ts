import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

/**
 * Merged from studentspark_backend/utils/openaiClient.js
 * Centralizes GPT-4o-mini text & vision completions, chunking (30,000 chars), and safe JSON parsing.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private client: OpenAI | null = null;

  getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key',
      });
    }
    return this.client;
  }

  async chatCompletion(params: {
    systemPrompt?: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }
    messages.push({ role: 'user', content: params.userPrompt });

    const response = await this.getClient().chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      temperature: params.temperature ?? 0.5,
      max_tokens: params.maxTokens,
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  async extractTextFromImageBatch(base64Images: string[]): Promise<string> {
    const response = await this.getClient().chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all readable text from these images. Preserve layout.',
            },
            ...base64Images.map((base64) => ({
              type: 'image_url' as const,
              image_url: {
                url: `data:image/jpeg;base64,${base64
                  .replace(/^data:image\/\w+;base64,/, '')
                  .replace(/\s+/g, '')}`,
              },
            })),
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  splitTextIntoChunks(text: string, maxChars = 30000): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.substring(i, i + maxChars));
    }
    return chunks;
  }

  cleanJsonOutput<T>(rawContent: string, fallback: T): T {
    const cleaned = rawContent
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (error) {
      this.logger.error('Failed to parse OpenAI JSON response', error);
      return fallback;
    }
  }
}
