import { Request, Response } from 'express';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectId } from 'mongodb';
import { loadS3Config } from '@repo/config';
import { asyncHandler } from '@repo/utils';
import { getMediaCollection } from '../models/media';

// File type whitelist
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/m4a', 'audio/wav'];
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const ALL_ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_AUDIO_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
];

// File size limits (in bytes)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_AUDIO_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB

const PresignRequestSchema = z.object({
  fileName: z.string().min(1, 'fileName is required'),
  fileType: z.string().refine((type) => ALL_ALLOWED_TYPES.includes(type), {
    message: `File type must be one of: ${ALL_ALLOWED_TYPES.join(', ')}`,
  }),
  fileSize: z.number().positive('fileSize must be positive'),
});

function getMaxSizeForType(fileType: string): number {
  if (ALLOWED_IMAGE_TYPES.includes(fileType)) {
    return MAX_IMAGE_SIZE;
  }
  if (ALLOWED_AUDIO_TYPES.includes(fileType)) {
    return MAX_AUDIO_SIZE;
  }
  if (ALLOWED_DOCUMENT_TYPES.includes(fileType)) {
    return MAX_DOCUMENT_SIZE;
  }
  return 0;
}

function validateFileSize(fileType: string, fileSize: number): void {
  const maxSize = getMaxSizeForType(fileType);

  if (fileSize > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024);
    throw new Error(`File size exceeds maximum allowed size of ${maxSizeMB}MB for this file type`);
  }
}

export const presign = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const parseResult = PresignRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: parseResult.error.errors[0].message,
      details: parseResult.error.errors,
    });
  }

  const { fileName, fileType, fileSize } = parseResult.data;

  // Validate file size against type-specific limits
  try {
    validateFileSize(fileType, fileSize);
  } catch (error: any) {
    return res.status(400).json({
      error: 'Validation Error',
      message: error.message,
    });
  }

  // Get authenticated user ID from request (set by auth middleware)
  const userId = (req as any).user?.userId;

  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  // Load S3 configuration
  const s3Config = loadS3Config();

  // Generate unique S3 key
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const fileExtension = fileName.split('.').pop() || '';
  const s3Key = `media/${userId}/${timestamp}-${randomString}.${fileExtension}`;

  // Create S3 client
  const s3Client = new S3Client({
    region: s3Config.S3_REGION,
    credentials:
      s3Config.AWS_ACCESS_KEY_ID && s3Config.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: s3Config.AWS_ACCESS_KEY_ID,
            secretAccessKey: s3Config.AWS_SECRET_ACCESS_KEY,
          }
        : undefined, // Use default credential provider chain if not specified
  });

  // Create presigned PUT URL
  const command = new PutObjectCommand({
    Bucket: s3Config.S3_MEDIA_BUCKET,
    Key: s3Key,
    ContentType: fileType,
  });

  const expiresIn = 300; // 5 minutes
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

  // Create media document in MongoDB
  const mediaCollection = getMediaCollection();
  const mediaDoc = {
    userId: new ObjectId(userId),
    fileName,
    fileType,
    fileSize,
    s3Key,
    url: `${s3Config.MEDIA_BASE_URL}/${s3Key}`,
    createdAt: new Date(),
  };

  const result = await mediaCollection.insertOne(mediaDoc);

  // Return presigned URL and media ID
  return res.status(200).json({
    uploadUrl,
    mediaId: result.insertedId.toString(),
    expiresIn,
  });
});
