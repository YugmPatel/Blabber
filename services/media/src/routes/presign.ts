import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger } from '@repo/utils';
import { getDatabase } from '../db';
import { getMediaCollection, Media } from '../models/media';
import {
  allowedMimeTypes,
  maxBytesForCategory,
  normalizeDeclaredMimeType,
  safeExtension,
  sanitizeDisplayFileName,
  validateMediaPolicy,
} from '../media-policy';
import { assertUserUploadQuota } from '../media-quota';
import { scanBuffer } from '../media-scanner';

const LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR || '/tmp/blabber-media';
const MULTIPART_FIELD_NAME = 'file';
// Pre-category-detection sanity ceiling only (we don't know the file's
// category — image/audio/document/video — until validateMediaPolicy runs).
// Must stay >= the largest per-category limit (video, 100mb) or it would
// silently override that limit for every upload before category-specific
// checks ever run. A function (like maxBytesForCategory in media-policy.ts)
// rather than a module-level constant, so it reflects env var changes made
// after this module first loads instead of freezing the value at import time.
function messageTotalAttachmentBytes() {
  return Number(process.env.MEDIA_MESSAGE_TOTAL_BYTES || 105 * 1024 * 1024);
}
const GENERIC_UPLOAD_ERROR = 'This file could not be uploaded.';
const execFileAsync = promisify(execFile);
const HEIC_DECODE_TIMEOUT_MS = Number(process.env.MEDIA_HEIC_DECODE_TIMEOUT_MS || 10_000);
const MAX_IMAGE_WIDTH = Number(process.env.MEDIA_MAX_IMAGE_WIDTH || 12_000);
const MAX_IMAGE_HEIGHT = Number(process.env.MEDIA_MAX_IMAGE_HEIGHT || 12_000);
const MAX_IMAGE_PIXELS = Number(process.env.MEDIA_MAX_IMAGE_PIXELS || 80_000_000);

// Specific, user-facing messages for every known failure reason. Every
// caller of uploadValidationError should pass one of these codes instead of
// relying on the generic fallback, per the P0 requirement that upload
// failures explain themselves instead of all reading "could not be
// uploaded."
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  no_file: 'No file was received. Please try again.',
  too_large: 'This file is too large to send.',
  unsafe_type: 'This file type is not supported here.',
  deceptive_extension: 'This file name looks suspicious and cannot be sent.',
  mime_mismatch: "This file's contents don't match its file type and cannot be sent.",
  invalid_image_dimensions: 'This image is too large or too small to process.',
  image_processing_failed: 'This photo could not be processed. Try a different photo or convert it to JPG first.',
  malware_detected: 'This file failed a security scan and cannot be sent.',
  scanner_unavailable: "We couldn't scan this file for safety right now. Please try again in a moment.",
  quota_exceeded: "You've reached your daily upload limit. Try again tomorrow.",
  not_found: 'This upload could not be found. Please try uploading again.',
  server_error: 'Something went wrong uploading this file. Please try again.',
};

function uploadValidationError(res: Response, code: keyof typeof UPLOAD_ERROR_MESSAGES | string = 'server_error', status = 400) {
  return res.status(status).json({
    error: status === 404 ? 'Not Found' : 'Validation Error',
    message: UPLOAD_ERROR_MESSAGES[code] || GENERIC_UPLOAD_ERROR,
    code,
  });
}

function shouldNormalizeImage(mimeType: string) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType);
}

function isHeicOrHeif(mimeType: string) {
  return mimeType === 'image/heic' || mimeType === 'image/heif';
}

function jpegDerivativeFileName(fileName: string) {
  const sanitized = sanitizeDisplayFileName(fileName);
  const withoutExtension = sanitized.replace(/\.[^.]+$/, '') || 'image';
  return `${withoutExtension}.jpg`;
}

function assertImageDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_WIDTH ||
    height > MAX_IMAGE_HEIGHT ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('invalid_image_dimensions');
  }
}

async function inspectImageDimensions(inputPath: string) {
  const probe = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', inputPath],
    { timeout: HEIC_DECODE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
  );
  const probeOutput = typeof probe === 'string' ? probe : probe.stdout;
  const metadata = JSON.parse(probeOutput || '{}');
  const stream = metadata.streams?.[0] || {};
  const width = Number(stream.width || 0);
  const height = Number(stream.height || 0);
  assertImageDimensions(width, height);
}

async function inspectHeicDimensions(inputPath: string) {
  const info = await execFileAsync('heif-info', [inputPath], {
    timeout: HEIC_DECODE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  const output = typeof info === 'string' ? info : `${info.stdout || ''}\n${info.stderr || ''}`;
  const match = output.match(/(\d{1,6})\s*x\s*(\d{1,6})/i);
  if (!match) throw new Error('invalid_image_dimensions');
  assertImageDimensions(Number(match[1]), Number(match[2]));
}

async function normalizeImageToJpeg(buffer: Buffer, fileName: string, mimeType: string) {
  const tempDir = await fs.mkdtemp(join(tmpdir(), 'blabber-image-'));
  const inputPath = join(tempDir, sanitizeDisplayFileName(fileName));
  const decodedPath = join(tempDir, 'decoded.jpg');
  const outputPath = join(tempDir, 'normalized.jpg');
  try {
    await fs.writeFile(inputPath, buffer);
    const sourcePath = isHeicOrHeif(mimeType) ? decodedPath : inputPath;

    if (isHeicOrHeif(mimeType)) {
      await inspectHeicDimensions(inputPath);
      await execFileAsync('heif-convert', [inputPath, decodedPath], {
        timeout: HEIC_DECODE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
    }

    await inspectImageDimensions(sourcePath);
    await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-frames:v', '1', '-map_metadata', '-1', '-q:v', '3', outputPath],
      { timeout: HEIC_DECODE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    );
    const normalizedBuffer = await fs.readFile(outputPath);
    if (normalizedBuffer.length === 0 || normalizedBuffer.length > maxBytesForCategory('image')) {
      throw new Error('invalid_normalized_image');
    }
    return {
      buffer: normalizedBuffer,
      fileName: jpegDerivativeFileName(fileName),
      mimeType: 'image/jpeg',
      extension: '.jpg',
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function getMultipartBoundary(req: Request): string | null {
  const contentType = req.get('content-type') || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] || match?.[2] || null;
}

function parseContentDisposition(value: string | undefined) {
  const result: { name?: string; filename?: string } = {};
  if (!value) return result;
  for (const part of value.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    const key = rawKey.toLowerCase();
    const joined = rawValue.join('=').trim();
    if (key === 'name' || key === 'filename') result[key] = joined.replace(/^"|"$/g, '');
  }
  return result;
}

function parseMultipartUpload(req: Request) {
  const body = req.body;
  const boundary = getMultipartBoundary(req);

  if (!boundary || !Buffer.isBuffer(body) || body.length === 0) return null;

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(boundaryBuffer);
  let file:
    | {
        fieldName: string;
        fileName: string;
        fileType: string;
        data: Buffer;
      }
    | null = null;

  while (cursor !== -1) {
    cursor += boundaryBuffer.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;

    const rawHeaders = body.toString('utf8', cursor, headerEnd);
    const headers = new Map<string, string>();
    for (const line of rawHeaders.split('\r\n')) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }

    const contentStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundaryBuffer, contentStart);
    if (nextBoundary === -1) break;

    let contentEnd = nextBoundary;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;

    const disposition = parseContentDisposition(headers.get('content-disposition'));
    if (disposition.filename && disposition.name) {
      file = {
        fieldName: disposition.name,
        fileName: sanitizeDisplayFileName(disposition.filename),
        fileType: headers.get('content-type') || 'application/octet-stream',
        data: body.subarray(contentStart, contentEnd),
      };
    }

    cursor = nextBoundary;
  }

  return { file };
}

function getPublicMediaBaseUrl(req: Request): string {
  const configuredBaseUrl = process.env.PUBLIC_MEDIA_BASE_URL?.replace(/\/+$/, '');
  if (configuredBaseUrl) return configuredBaseUrl;

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

function publicResponse(mediaDoc: Media) {
  return {
    mediaId: mediaDoc._id?.toString(),
    mediaUrl: mediaDoc.url,
    publicUrl: mediaDoc.url,
    storageKey: mediaDoc.s3Key,
    fileName: mediaDoc.fileName,
    mimeType: mediaDoc.fileType,
    detectedMimeType: mediaDoc.detectedFileType,
    size: mediaDoc.fileSize,
    status: mediaDoc.status,
    storage: mediaDoc.storage,
  };
}

async function isPrivateSocialMedia(mediaId: ObjectId) {
  const db = getDatabase();
  const [momentReference, postReference, communityReference, communityPostReference, reelReference, messageReference, avatarReference] = await Promise.all([
    db.collection('moments').findOne({ mediaId, archiveState: { $ne: 'deleted' } }),
    db.collection('posts').findOne({ mediaIds: mediaId, deletedAt: { $exists: false } }),
    db.collection('communities').findOne({ avatarMediaId: mediaId, deletedAt: { $exists: false } }),
    db.collection('community_posts').findOne({ mediaIds: mediaId, deletedAt: { $exists: false } }),
    db.collection('reels').findOne({
      $or: [
        { sourceMediaId: mediaId },
        { fallbackMediaId: mediaId },
        { posterMediaId: mediaId },
      ],
      deletedAt: { $exists: false },
    }),
    db.collection('messages').findOne({
      $or: [{ 'media.mediaId': mediaId.toString() }, { 'attachments.mediaId': mediaId.toString() }],
    }),
    db.collection('users').findOne({ avatarUrl: { $regex: mediaId.toString() } }),
  ]);
  return Boolean((momentReference || postReference || communityReference || communityPostReference || reelReference) && !messageReference && !avatarReference);
}

function hasMomentInternalAccess(req: Request) {
  const token = process.env.MOMENT_INTERNAL_MEDIA_TOKEN;
  return Boolean(token && req.get('x-moment-internal-token') === token);
}

async function approveLocalBuffer(params: {
  req: Request;
  res: Response;
  userId: string;
  mediaDoc?: Media;
  mediaId?: ObjectId;
  fileName: string;
  declaredMimeType?: string;
  buffer: Buffer;
}) {
  const { req, res, userId, buffer } = params;
  const userObjectId = new ObjectId(userId);

  if (buffer.length === 0) return uploadValidationError(res, 'unsafe_type');
  if (buffer.length > messageTotalAttachmentBytes()) return uploadValidationError(res, 'too_large');

  let policy;
  try {
    policy = validateMediaPolicy({ fileName: params.fileName, declaredMimeType: params.declaredMimeType, buffer });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unsafe_type';
    return uploadValidationError(res, code);
  }
  // General chat/group attachment uploads (this route) now accept video
  // directly — no transcoding is performed, so playback depends on browser
  // support for the uploaded container/codec (see media-policy.ts). Reels
  // and moment videos are unaffected: they go through their own dedicated
  // upload routes (routes/reels.ts, routes/moment-videos.ts), never this one.

  if (buffer.length > maxBytesForCategory(policy.category)) return uploadValidationError(res, 'too_large');

  try {
    await assertUserUploadQuota(userObjectId, buffer.length);
  } catch {
    return uploadValidationError(res, 'quota_exceeded', 429);
  }

  const mediaId = params.mediaId || new ObjectId();
  let approvedBuffer = buffer;
  let approvedFileName = sanitizeDisplayFileName(params.fileName);
  let approvedMimeType = policy.mimeType;
  let approvedExtension = policy.extension;
  const shouldNormalize = shouldNormalizeImage(policy.mimeType);
  const publicBaseUrl = getPublicMediaBaseUrl(req);
  const mediaUrl = params.mediaDoc?.url || `${publicBaseUrl}/local/${mediaId.toString()}`;
  const pendingLocalPath = params.mediaDoc?.localPath || join(LOCAL_MEDIA_DIR, `${mediaId.toString()}${policy.extension}`);
  const pendingS3Key = params.mediaDoc?.s3Key || `local/${userId}/${mediaId.toString()}${policy.extension}`;
  const mediaCollection = getMediaCollection();
  const now = new Date();

  await mediaCollection.updateOne(
    { _id: mediaId, userId: userObjectId },
    {
      $set: {
        status: 'scanning',
        scanResult: undefined,
        scanErrorCategory: undefined,
        detectedFileType: policy.mimeType,
        fileType: policy.mimeType,
        fileSize: buffer.length,
        fileName: approvedFileName,
      },
      $setOnInsert: {
        _id: mediaId,
        userId: userObjectId,
        originalFileName: params.fileName,
        s3Key: pendingS3Key,
        url: mediaUrl,
        storage: 'local',
        localPath: pendingLocalPath,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const scan = await scanBuffer(buffer);
  if (!scan.ok) {
    await mediaCollection.updateOne(
      { _id: mediaId },
      {
        $set: {
          status: scan.category === 'infected' ? 'quarantined' : 'rejected',
          scanMode: scan.mode,
          scanResult: scan.category === 'infected' ? 'infected' : 'error',
          scanErrorCategory: scan.category,
          rejectedAt: now,
          quarantinedAt: scan.category === 'infected' ? now : undefined,
        },
      }
    );
    return uploadValidationError(res, scan.category === 'infected' ? 'malware_detected' : 'scanner_unavailable');
  }

  if (shouldNormalize) {
    try {
      const normalized = await normalizeImageToJpeg(buffer, params.fileName, policy.mimeType);
      approvedBuffer = normalized.buffer;
      approvedFileName = normalized.fileName;
      approvedMimeType = normalized.mimeType;
      approvedExtension = normalized.extension;
    } catch (error) {
      if (isHeicOrHeif(policy.mimeType)) {
        // We couldn't produce a JPEG preview (missing/failed heif-convert or
        // ffmpeg, an unusual HEIC variant, etc.) — rather than silently
        // rejecting a genuinely valid iPhone photo, fall back to storing the
        // original HEIC/HEIF file as-is. The frontend shows a "preview not
        // available, tap to open" state for images it can't decode inline
        // instead of a broken <img>.
        logger.warn(
          { error, fileName: params.fileName, mimeType: policy.mimeType },
          'HEIC/HEIF normalization failed; falling back to storing the original file'
        );
      } else {
        const code = error instanceof Error && error.message === 'invalid_image_dimensions'
          ? 'invalid_image_dimensions'
          : 'image_processing_failed';
        await mediaCollection.updateOne(
          { _id: mediaId },
          {
            $set: {
              status: 'rejected',
              scanMode: scan.mode,
              scanResult: 'clean',
              scanErrorCategory: undefined,
              rejectedAt: new Date(),
            },
          }
        );
        return uploadValidationError(res, code);
      }
    }
  }

  const localPath =
    params.mediaDoc?.localPath && !shouldNormalize
      ? params.mediaDoc.localPath
      : join(LOCAL_MEDIA_DIR, `${mediaId.toString()}${approvedExtension}`);
  const s3Key =
    params.mediaDoc?.s3Key && !shouldNormalize
      ? params.mediaDoc.s3Key
      : `local/${userId}/${mediaId.toString()}${approvedExtension}`;

  await fs.mkdir(dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, approvedBuffer, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
    await fs.writeFile(localPath, approvedBuffer);
  });

  const approvedAt = new Date();
  const approvedDoc: Media = {
    ...(params.mediaDoc || {}),
    _id: mediaId,
    userId: userObjectId,
    fileName: approvedFileName,
    originalFileName: params.fileName,
    fileType: approvedMimeType,
    detectedFileType: policy.mimeType,
    fileSize: approvedBuffer.length,
    s3Key,
    url: mediaUrl,
    storage: 'local',
    localPath,
    status: 'approved',
    scanMode: scan.mode,
    scanResult: 'clean',
    approvedAt,
    uploadedAt: approvedAt,
    createdAt: params.mediaDoc?.createdAt || now,
  };

  await mediaCollection.updateOne(
    { _id: mediaId },
    {
      $set: {
        fileName: approvedFileName,
        originalFileName: params.fileName,
        fileType: approvedMimeType,
        detectedFileType: policy.mimeType,
        fileSize: approvedBuffer.length,
        s3Key,
        url: mediaUrl,
        storage: 'local',
        localPath,
        status: 'approved',
        scanMode: scan.mode,
        scanResult: 'clean',
        approvedAt,
        uploadedAt: approvedAt,
      },
    }
  );

  return res.status(params.mediaDoc ? 200 : 201).json(publicResponse(approvedDoc));
}

export const uploadMultipartMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const file = parseMultipartUpload(req)?.file;
  if (!file || file.fieldName !== MULTIPART_FIELD_NAME) return uploadValidationError(res, 'no_file');

  return approveLocalBuffer({
    req,
    res,
    userId,
    fileName: file.fileName,
    declaredMimeType: file.fileType,
    buffer: file.data,
  });
});

export const presign = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const fileName = sanitizeDisplayFileName(String(req.body?.fileName || ''));
  const declaredType = normalizeDeclaredMimeType(String(req.body?.fileType || ''));
  const fileSize = Number(req.body?.fileSize || 0);
  if (!fileName) return uploadValidationError(res, 'unsafe_type');
  if (!Number.isFinite(fileSize) || fileSize <= 0) return uploadValidationError(res, 'unsafe_type');
  if (fileSize > messageTotalAttachmentBytes()) return uploadValidationError(res, 'too_large');
  if (declaredType && !allowedMimeTypes().includes(declaredType)) {
    return uploadValidationError(res, 'unsafe_type');
  }
  // This presign+PUT flow is only used for avatar uploads (profile/group
  // photo) — never chat/group message attachments, which go through
  // uploadMultipartMedia above and now accept video. Avatars staying
  // image-only is intentional and unrelated to that.
  if (declaredType === 'video/mp4') return uploadValidationError(res, 'unsafe_type');

  const extension = safeExtension(fileName);
  const mediaId = new ObjectId();
  const publicBaseUrl = getPublicMediaBaseUrl(req);
  const mediaUrl = `${publicBaseUrl}/local/${mediaId.toString()}`;
  const localPath = join(LOCAL_MEDIA_DIR, `${mediaId.toString()}${extension || '.bin'}`);
  const uploadUrl = `${getLocalUploadBaseUrl(req)}/local/${mediaId.toString()}`;
  const mediaDoc: Media = {
    _id: mediaId,
    userId: new ObjectId(userId),
    fileName,
    originalFileName: fileName,
    fileType: declaredType || 'application/octet-stream',
    fileSize,
    s3Key: `local/${userId}/${mediaId.toString()}${extension || '.bin'}`,
    url: mediaUrl,
    storage: 'local',
    localPath,
    status: 'pending',
    createdAt: new Date(),
  };

  await getMediaCollection().insertOne(mediaDoc);

  return res.status(200).json({
    uploadUrl,
    ...publicResponse(mediaDoc),
    uploadMethod: 'PUT',
    uploadAuthRequired: true,
  });
});

export const uploadLocalMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }
  if (!ObjectId.isValid(req.params.id)) return uploadValidationError(res, 'not_found', 404);

  const uploadBody = req.body;
  if (!Buffer.isBuffer(uploadBody) || uploadBody.length === 0) return uploadValidationError(res, 'unsafe_type');

  const mediaId = new ObjectId(req.params.id);
  const mediaDoc = await getMediaCollection().findOne({
    _id: mediaId,
    userId: new ObjectId(userId),
    storage: 'local',
    status: { $in: ['pending', 'rejected'] },
  });

  if (!mediaDoc?.localPath) return uploadValidationError(res, 'not_found', 404);
  if (uploadBody.length > mediaDoc.fileSize || uploadBody.length > messageTotalAttachmentBytes()) {
    return uploadValidationError(res, 'too_large');
  }

  return approveLocalBuffer({
    req,
    res,
    userId,
    mediaDoc,
    mediaId,
    fileName: mediaDoc.fileName,
    declaredMimeType: req.get('content-type') || mediaDoc.fileType,
    buffer: uploadBody,
  });
});

export const getLocalMedia = asyncHandler(async (req: Request, res: Response) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: 'Not Found', message: 'Media not found' });
  }

  // Media uploaded before the scan pipeline existed has no `status` field at
  // all; those uploads completed (the `uploadedAt` check below still applies)
  // and must stay servable — avatars and group photos reference them.
  const mediaDoc = await getMediaCollection().findOne({
    _id: new ObjectId(req.params.id),
    storage: 'local',
    $or: [{ status: 'approved' }, { status: { $exists: false } }],
  });

  if (!mediaDoc?.localPath || !mediaDoc.uploadedAt) {
    return res.status(404).json({ error: 'Not Found', message: 'Media not found' });
  }

  if (!hasMomentInternalAccess(req) && (await isPrivateSocialMedia(mediaDoc._id!))) {
    return res.status(404).json({ error: 'Not Found', message: 'Media not found' });
  }

  try {
    await fs.access(mediaDoc.localPath);
  } catch {
    return res.status(404).json({ error: 'Not Found', message: 'Media not found' });
  }

  res.setHeader('Content-Type', mediaDoc.fileType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeDisplayFileName(mediaDoc.fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.sendFile(mediaDoc.localPath);
});
