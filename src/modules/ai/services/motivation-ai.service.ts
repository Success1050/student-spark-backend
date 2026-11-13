import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { OpenAiService } from './openai.service.js';

/**
 * Merged from studentspark_backend/AIRoutes/motivationGen.js
 * Generates a short 3-line motivational quote for students and updates user profile.
 */
@Injectable()
export class MotivationAiService {
  private readonly logger = new Logger(MotivationAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiService: OpenAiService,
  ) {}

  async generateDailyMotivation(userId: string): Promise<string> {
    if (!userId) {
      throw new BadRequestException('Missing userId in request body');
    }

    const motivation = await this.openAiService.chatCompletion({
      userPrompt:
        'Generate a short, 3-line motivational quote for students about focus, consistency, and learning. Keep it inspiring and original.',
      maxTokens: 60,
      temperature: 0.8,
    });

    await this.prisma.user
      .update({
        where: { id: userId },
        data: { motivation },
      })
      .catch((err) => this.logger.warn(`Profile motivation update skipped: ${err.message}`));

    return motivation;
  }
}
