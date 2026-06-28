import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getDatabase } from '../db';
import { getMediaCollection, Media } from '../models/media';
import {
  allowedMimeTypes,
  maxBytesForCategory,
  safeExtension,
  sanitizeDisplayFileName,
  validateMediaPolicy,
} from '../media-policy';
import { assertUserUploadQuota } from '../media-quota';
import { scanBuffer } from '../media-scanner';

const LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR || '/tmp/blabber-media';
const MULTIPART_FIELD_NAME = 'file';
const MESSAGE_TOTAL_ATTACHMENT_BYTES = Number(process.env.MEDIA_MESSAGE_TOTAL_BYTES || 30 * 1024 * 1024);
const GENERIC_UPLOAD_ERROR = 'This file could not be uploaded.';

function uploadValidationError(res: Response, status = 400) {
  return res.status(status).json({ error: status === 404 ? 'Not Found' : 'Validation Error', message: GENERIC_UPLOAD_ERROR });
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

async function isMomentOnlyMedia(mediaId: ObjectId) {
  const db = getDatabase();
  const moment = await db.collection('moments').findOne({ mediaId, archiveState: { $ne: 'deleted' } });
  if (!moment) return false;
  const [messageReference, avatarReference] = await Promise.all([
    db.collection('messages').findOne({
      $or: [{ 'media.mediaId': mediaId.toString() }, { 'attachments.mediaId': mediaId.toString() }],
    }),
    db.collection('users').findOne({ avatarUrl: { $regex: mediaId.toString() } }),
  ]);
  return !messageReference && !avatarReference;
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

  if (buffer.length === 0 || buffer.length > MESSAGE_TOTAL_ATTACHMENT_BYTES) return uploadValidationError(res);

  let policy;
  try {
    policy = validateMediaPolicy({ fileName: params.fileName, declaredMimeType: params.declaredMimeType, buffer });
  } catch {
    return uploadValidationError(res);
  }

  if (buffer.length > maxBytesForCategory(policy.category)) return uploadValidationError(res);

  try {
    await assertUserUploadQuota(userObjectId, buffer.length);
  } catch {
    return uploadValidationError(res, 429);
  }

  const mediaId = params.mediaId || new ObjectId();
  const fileName = sanitizeDisplayFileName(params.fileName);
  const localPath = params.mediaDoc?.localPath || join(LOCAL_MEDIA_DIR, `${mediaId.toString()}${policy.extension}`);
  const publicBaseUrl = getPublicMediaBaseUrl(req);
  const mediaUrl = params.mediaDoc?.url || `${publicBaseUrl}/local/${mediaId.toString()}`;
  const s3Key = params.mediaDoc?.s3Key || `local/${userId}/${mediaId.toString()}${policy.extension}`;
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
        fileName,
      },
      $setOnInsert: {
        _id: mediaId,
        userId: userObjectId,
        originalFileName: params.fileName,
        s3Key,
        url: mediaUrl,
        storage: 'local',
        localPath,
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
    return uploadValidationError(res);
  }

  await fs.mkdir(dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, buffer, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
    await fs.writeFile(localPath, buffer);
  });

  const approvedAt = new Date();
  const approvedDoc: Media = {
    ...(params.mediaDoc || {}),
    _id: mediaId,
    userId: userObjectId,
    fileName,
    originalFileName: params.fileName,
    fileType: policy.mimeType,
    detectedFileType: policy.mimeType,
    fileSize: buffer.length,
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
        fileName,
        originalFileName: params.fileName,
        fileType: policy.mimeType,
        detectedFileType: policy.mimeType,
        fileSize: buffer.length,
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
  if (!file || file.fieldName !== MULTIPART_FIELD_NAME) return uploadValidationError(res);

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
  const declaredType = String(req.body?.fileType || '').split(';')[0].trim().toLowerCase();
  const fileSize = Number(req.body?.fileSize || 0);
  if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MESSAGE_TOTAL_ATTACHMENT_BYTES) {
    return uploadValidationError(res);
  }
  if (declaredType && !allowedMimeTypes().includes(declaredType) && declaredType !== 'image/jpg') {
    return uploadValidationError(res);
  }

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
  if (!ObjectId.isValid(req.params.id)) return uploadValidationError(res, 404);

  const uploadBody = req.body;
  if (!Buffer.isBuffer(uploadBody) || uploadBody.length === 0) return uploadValidationError(res);

  const mediaId = new ObjectId(req.params.id);
  const mediaDoc = await getMediaCollection().findOne({
    _id: mediaId,
    userId: new ObjectId(userId),
    storage: 'local',
    status: { $in: ['pending', 'rejected'] },
  });

  if (!mediaDoc?.localPath) return uploadValidationError(res, 404);
  if (uploadBody.length > mediaDoc.fileSize || uploadBody.length > MESSAGE_TOTAL_ATTACHMENT_BYTES) {
    return uploadValidationError(res);
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

  const mediaDoc = await getMediaCollection().findOne({
    _id: new ObjectId(req.params.id),
    storage: 'local',
    status: 'approved',
  });

  if (!mediaDoc?.localPath || !mediaDoc.uploadedAt) {
    return res.status(404).json({ error: 'Not Found', message: 'Media not found' });
  }

  if (!hasMomentInternalAccess(req) && (await isMomentOnlyMedia(mediaDoc._id!))) {
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
