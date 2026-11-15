import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Replaces supabase.storage.from('notes') and supabase.storage.from('avatars')
 * Uses Cloudinary configured in student-spark/.env
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadPdfBuffer(
    fileBuffer: Buffer,
    fileName: string,
    folder: 'notes' | 'past-questions' | 'marketplace' | 'report-cards' = 'notes',
  ): Promise<{ filePath: string; publicUrl: string }> {
    this.logger.log(`Uploading ${fileName} (${fileBuffer.byteLength} bytes) to Cloudinary/${folder}`);

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `studentspark/${folder}`,
          public_id: fileName,
          resource_type: 'raw',
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error('Cloudinary upload error', error);
            return reject(error ?? new Error('Cloudinary upload failed'));
          }
          resolve({
            filePath: result.public_id,
            publicUrl: result.secure_url,
          });
        },
      );
      uploadStream.end(fileBuffer);
    });
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!filePath) return;
    try {
      await cloudinary.uploader.destroy(filePath, { resource_type: 'raw' });
      this.logger.log(`Rolled back / deleted storage file: ${filePath}`);
    } catch (error) {
      this.logger.warn(`Failed to delete storage file ${filePath}`, error);
    }
  }
}
