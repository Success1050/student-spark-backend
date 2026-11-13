import { Injectable, Logger } from '@nestjs/common';

/**
 * BullMQ background job processor for heavy PDF Vision OCR & multi-chunk AI tasks.
 */
@Injectable()
export class AiProcessingProcessor {
  private readonly logger = new Logger(AiProcessingProcessor.name);

  async handleHeavyPdfOcrJob(jobData: { userId: string; title: string; fileUrl: string }) {
    this.logger.log(`Processing background OCR job for ${jobData.title}`);
  }
}
