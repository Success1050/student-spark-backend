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

    // Strip trailing .pdf from Cloudinary raw public_id so direct delivery
    // is never blocked by Cloudinary's raw .pdf ACL restriction (HTTP 401).
    const cleanPublicId = fileName.replace(/\.pdf$/i, '');

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `studentspark/${folder}`,
          public_id: cleanPublicId,
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

  /**
   * Resolves a Cloudinary raw PDF URL into an accessible HTTPS download URL.
   * Existing uploads whose public_id ended with `.pdf` return HTTP 401 on direct
   * `res.cloudinary.com` delivery; `private_download_url` serves them with HTTP 200.
   */
  getAccessiblePdfUrl(fileUrl?: string | null): string | null {
    if (!fileUrl) return null;
    const match = fileUrl.match(/res\.cloudinary\.com\/[^/]+\/raw\/upload\/(?:v\d+\/)?(.+)$/i);
    if (!match) return fileUrl;

    const publicId = decodeURIComponent(match[1]);
    if (!/\.pdf$/i.test(publicId)) {
      return fileUrl;
    }

    try {
      return cloudinary.utils.private_download_url(publicId, '', {
        resource_type: 'raw',
        type: 'upload',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    } catch (error) {
      this.logger.warn(`Failed to sign Cloudinary PDF URL for ${publicId}`, error);
      return fileUrl;
    }
  }

  async uploadImageBuffer(
    fileBuffer: Buffer,
    fileName: string,
    folder: 'sug-candidates' | 'avatars' | 'marketplace' = 'sug-candidates',
  ): Promise<{ filePath: string; publicUrl: string }> {
    this.logger.log(`Uploading image ${fileName} (${fileBuffer.byteLength} bytes) to Cloudinary/${folder}`);

    const cleanPublicId = fileName.replace(/\.(png|jpe?g|webp|gif)$/i, '');

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `studentspark/${folder}`,
          public_id: cleanPublicId,
          resource_type: 'image',
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error('Cloudinary image upload error', error);
            return reject(error ?? new Error('Cloudinary image upload failed'));
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
