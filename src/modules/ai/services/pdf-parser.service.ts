import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { fromBuffer } from 'pdf2pic';
import { OpenAiService } from './openai.service.js';

/**
 * Merged from studentspark_backend/AIRoutes/uploadpdfRoute.js & utils/pdfToImages.js
 * Extracts text via pdf-extraction, strips CamScanner watermarks, and falls back to
 * batched GPT-4o-mini Vision OCR (5 pages per batch) when PDF is scanned.
 */
@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  constructor(private readonly openAiService: OpenAiService) {}

  async convertPdfBufferToBase64Images(pdfBuffer: Buffer): Promise<string[]> {
    const tmpDir = os.tmpdir();
    const savePath = `${tmpDir}/pdf2pic_${Date.now()}_${randomUUID()}`;
    fs.mkdirSync(savePath, { recursive: true });

    try {
      const converter = fromBuffer(pdfBuffer, {
        density: 120,
        saveFilename: 'page',
        savePath,
        format: 'jpg',
        width: 1200,
        height: 1200,
      });

      const results = await converter.bulk(-1, { responseType: 'base64' });
      const base64Images = (results || [])
        .filter((r): r is { base64: string } => Boolean(r && r.base64))
        .map((r) => r.base64);

      if (!base64Images.length) {
        throw new Error('PDF conversion returned no images');
      }
      return base64Images;
    } finally {
      try {
        if (fs.existsSync(savePath)) {
          fs.rmSync(savePath, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        this.logger.warn(`Cleanup warning: ${(cleanupErr as Error).message}`);
      }
    }
  }

  async extractTextFromPdfBuffer(fileBuffer: Buffer): Promise<string> {
    let pdfText = '';

    try {
      const pdfExtractModule = await import('pdf-extraction');
      const pdfExtract = pdfExtractModule.default || pdfExtractModule;
      const extracted = await pdfExtract(fileBuffer);
      pdfText = extracted?.text || '';
    } catch (err) {
      this.logger.warn(`Direct PDF text extraction failed, falling back to OCR: ${(err as Error).message}`);
    }

    const cleanText = pdfText
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
      .replace(/CamScanner/gi, '')
      .replace(/\n/g, '')
      .trim();

    const hasNoText = !pdfText || cleanText.length < 50;

    if (hasNoText) {
      this.logger.log('PDF appears scanned -> performing batched GPT-4o-mini Vision OCR');
      const images = await this.convertPdfBufferToBase64Images(fileBuffer);
      const batchSize = 5;
      const ocrTexts: string[] = [];

      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        this.logger.log(
          `OCR processing pages ${i + 1} to ${Math.min(i + batchSize, images.length)}...`,
        );
        const batchText = await this.openAiService.extractTextFromImageBatch(batch);
        ocrTexts.push(batchText);
      }
      pdfText = ocrTexts.join('\n\n');
    }

    return pdfText.trim();
  }
}
