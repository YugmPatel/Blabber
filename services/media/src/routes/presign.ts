import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectId } from 'mongodb';
import { loadS3Config } from '@repo/config';
import { asyncHandler } from '@repo/utils';
import { getMediaCollection } from '../models/media';

// File type whitelist
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/webm',
];
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/rtf',
  'text/rtf',
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
const LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR || '/tmp/blabber-media';

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

function getFileExtension(fileName: string): string {
  const extension = fileName.split('.').pop();
  return extension && extension !== fileName ? `.${extension}` : '';
}

function getPublicMediaBaseUrl(req: Request): string {
  const configuredBaseUrl = process.env.PUBLIC_MEDIA_BASE_URL?.replace(/\/+$/, '');
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
    return `${forwardedProto}://${forwardedHost}/api/media`;
  }

  return 'http://localhost:3000/api/media';
}

function getLocalUploadBaseUrl(req: Request): string {
  return process.env.LOCAL_MEDIA_UPLOAD_BASE_URL?.replace(/\/+$/, '') || getPublicMediaBaseUrl(req);
}

async function createLocalUpload(
  req: Request,
  res: Response,
  userId: string,
  fileName: string,
  fileType: string,
  fileSize: number
) {
  const mediaId = new ObjectId();
  const fileExtension = getFileExtension(fileName);
  const localPath = join(LOCAL_MEDIA_DIR, `${mediaId.toString()}${fileExtension}`);
  const publicBaseUrl = getPublicMediaBaseUrl(req);
  const mediaUrl = `${publicBaseUrl}/local/${mediaId.toString()}`;
  const uploadUrl = `${getLocalUploadBaseUrl(req)}/local/${mediaId.toString()}`;

  const mediaCollection = getMediaCollection();
  const mediaDoc = {
    _id: mediaId,
    userId: new ObjectId(userId),
    fileName,
    fileType,
    fileSize,
    s3Key: `local/${userId}/${mediaId.toString()}${fileExtension}`,
    url: mediaUrl,
    storage: 'local' as const,
    localPath,
    createdAt: new Date(),
  };

  await mediaCollection.insertOne(mediaDoc);

  return res.status(200).json({
    uploadUrl,
    mediaId: mediaId.toString(),
    mediaUrl,
    publicUrl: mediaUrl,
    storageKey: mediaDoc.s3Key,
    fileName,
    mimeType: fileType,
    size: fileSize,
    uploadMethod: 'PUT',
    uploadAuthRequired: true,
    storage: 'local',
  });
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

  const hasS3Config =
    Boolean(process.env.S3_MEDIA_BUCKET) &&
    Boolean(process.env.S3_REGION) &&
    Boolean(process.env.MEDIA_BASE_URL);

  if (!hasS3Config) {
    return createLocalUpload(req, res, userId, fileName, fileType, fileSize);
  }

  const s3Config = loadS3Config();

  // Generate unique S3 key
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const fileExtension = getFileExtension(fileName);
  const s3Key = `media/${userId}/${timestamp}-${randomString}${fileExtension}`;

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
    storage: 's3' as const,
    createdAt: new Date(),
  };

  const result = await mediaCollection.insertOne(mediaDoc);

  // Return presigned URL and media ID
  return res.status(200).json({
    uploadUrl,
    mediaId: result.insertedId.toString(),
    mediaUrl: mediaDoc.url,
    publicUrl: mediaDoc.url,
    storageKey: s3Key,
    fileName,
    mimeType: fileType,
    size: fileSize,
    expiresIn,
    uploadMethod: 'PUT',
    uploadAuthRequired: false,
    storage: 's3',
  });
});

export const uploadLocalMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;

  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  if (!ObjectId.isValid(req.params.id) || !ObjectId.isValid(userId)) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Media upload target not found',
    });
  }

  const uploadBody = req.body;
  if (!Buffer.isBuffer(uploadBody) || uploadBody.length === 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Upload body is required',
    });
  }

  const mediaId = new ObjectId(req.params.id);
  const mediaCollection = getMediaCollection();
  const mediaDoc = await mediaCollection.findOne({
    _id: mediaId,
    userId: new ObjectId(userId),
    storage: 'local',
  });

  if (!mediaDoc?.localPath) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Media upload target not found',
    });
  }

  if (uploadBody.length > mediaDoc.fileSize) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Uploaded file is larger than the presigned file size',
    });
  }

  const contentType = req.get('content-type')?.split(';')[0]?.trim();
  if (contentType && contentType !== mediaDoc.fileType) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Uploaded file type does not match the presigned file type',
    });
  }

  await fs.mkdir(dirname(mediaDoc.localPath), { recursive: true });
  await fs.writeFile(mediaDoc.localPath, uploadBody);
  await mediaCollection.updateOne(
    { _id: mediaId },
    {
      $set: {
        uploadedAt: new Date(),
      },
    }
  );

  return res.status(200).json({
    mediaId: mediaId.toString(),
    mediaUrl: mediaDoc.url,
    publicUrl: mediaDoc.url,
    storageKey: mediaDoc.s3Key,
    fileName: mediaDoc.fileName,
    mimeType: mediaDoc.fileType,
    size: mediaDoc.fileSize,
  });
});

export const getLocalMedia = asyncHandler(async (req: Request, res: Response) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Media not found',
    });
  }

  const mediaCollection = getMediaCollection();
  const mediaDoc = await mediaCollection.findOne({
    _id: new ObjectId(req.params.id),
    storage: 'local',
  });

  if (!mediaDoc?.localPath || !mediaDoc.uploadedAt) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Media not found',
    });
  }

  try {
    await fs.access(mediaDoc.localPath);
  } catch {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Media file not found',
    });
  }

  res.setHeader('Content-Type', mediaDoc.fileType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.sendFile(mediaDoc.localPath);
});
