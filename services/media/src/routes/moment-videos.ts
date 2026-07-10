import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { asyncHandler } from '@repo/utils';
import { getDatabase } from '../db';
import { scanBuffer } from '../media-scanner';
import { safeExtension, sanitizeDisplayFileName } from '../media-policy';
import { getMediaCollection } from '../models/media';
import { getMomentVideosCollection } from '../models/moment-video';
import { REEL_ERROR_MESSAGE, REEL_MAX_SOURCE_BYTES } from '../reel-constants';

const MEDIA_ROOT = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';

const uploadInitSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  fileType: z.string().trim().toLowerCase(),
  fileSize: z.number().int().positive().max(REEL_MAX_SOURCE_BYTES),
}).strict();

function unavailable(res: Response) {
  res.status(404).json({ error: 'Not Found', message: 'Video Moment unavailable.' });
}

function validationError(res: Response, message = REEL_ERROR_MESSAGE) {
  res.status(400).json({ error: 'Validation Error', message });
}

function requireUserId(req: Request) {
  const userId = req.user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    const error: any = new Error('Authentication required');
    error.statusCode = 401;
    throw error;
  }
  return new ObjectId(userId);
}

function activeUserQuery(extra: Record<string, unknown> = {}) {
  return { ...extra, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } };
}

async function requireActiveUser(userId: ObjectId) {
  const user = await getDatabase().collection('users').findOne(activeUserQuery({ _id: userId }) as any);
  if (!user) {
    const error: any = new Error('Authentication required');
    error.statusCode = 401;
    throw error;
  }
  return user;
}

function isMp4Upload(fileName: string, fileType: string) {
  const type = fileType.split(';')[0].trim().toLowerCase();
  return safeExtension(fileName) === '.mp4' && type === 'video/mp4';
}

export const initiateMomentVideoUpload = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsedUpload = uploadInitSchema.safeParse(req.body);
  if (!parsedUpload.success) {
    validationError(res);
    return;
  }
  const parsed = parsedUpload.data;
  const fileName = sanitizeDisplayFileName(parsed.fileName);
  if (!isMp4Upload(fileName, parsed.fileType)) {
    validationError(res);
    return;
  }
  const now = new Date();
  const videoId = new ObjectId();
  const mediaId = new ObjectId();
  const localPath = join(MEDIA_ROOT, 'moment-video-sources', `${mediaId.toString()}.mp4`);
  await getMediaCollection().insertOne({
    _id: mediaId,
    userId,
    fileName,
    originalFileName: parsed.fileName,
    fileType: 'video/mp4',
    fileSize: parsed.fileSize,
    s3Key: `moment-video-source/${userId.toString()}/${mediaId.toString()}.mp4`,
    url: '',
    storage: 'local',
    localPath,
    status: 'pending',
    purpose: 'moment_video_source',
    momentVideoId: videoId,
    createdAt: now,
  });
  await getMomentVideosCollection().insertOne({
    _id: videoId,
    authorUserId: userId,
    sourceMediaId: mediaId,
    processingStatus: 'upload_initiated',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  });
  res.status(201).json({
    videoId: videoId.toString(),
    uploadUrl: `/api/media/moment-videos/uploads/${videoId.toString()}/source`,
    uploadMethod: 'PUT',
    status: 'upload_initiated',
  });
});

export const uploadMomentVideoSource = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.videoId)) {
    unavailable(res);
    return;
  }
  const video = await getMomentVideosCollection().findOne({
    _id: new ObjectId(req.params.videoId),
    authorUserId: userId,
    deletedAt: { $exists: false },
  });
  if (!video || video.processingStatus !== 'upload_initiated') {
    unavailable(res);
    return;
  }
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length <= 0 || body.length > REEL_MAX_SOURCE_BYTES) {
    validationError(res);
    return;
  }
  const media = await getMediaCollection().findOne({
    _id: video.sourceMediaId,
    userId,
    status: 'pending',
    purpose: 'moment_video_source',
  });
  if (!media?.localPath) {
    unavailable(res);
    return;
  }
  await getMediaCollection().updateOne({ _id: media._id }, { $set: { status: 'scanning', updatedAt: new Date() } } as any);
  const scan = await scanBuffer(body);
  if (!scan.ok) {
    await getMediaCollection().updateOne({ _id: media._id }, { $set: { status: scan.category === 'infected' ? 'quarantined' : 'rejected', scanResult: scan.category === 'infected' ? 'infected' : 'error', scanMode: scan.mode, scanErrorCategory: scan.category, rejectedAt: new Date() } });
    await getMomentVideosCollection().updateOne({ _id: video._id }, { $set: { processingStatus: 'rejected', validationFailureCategory: 'scanner_rejected', updatedAt: new Date() } });
    validationError(res);
    return;
  }
  if (body.toString('ascii', 4, 8) !== 'ftyp') {
    validationError(res);
    return;
  }
  await fs.mkdir(dirname(media.localPath), { recursive: true });
  await fs.writeFile(media.localPath, body);
  const now = new Date();
  await getMediaCollection().updateOne({ _id: media._id }, { $set: { status: 'approved', scanMode: scan.mode, scanResult: 'clean', detectedFileType: 'video/mp4', fileType: 'video/mp4', fileSize: body.length, uploadedAt: now, approvedAt: now } });
  await getMomentVideosCollection().updateOne({ _id: video._id, processingStatus: 'upload_initiated' }, { $set: { processingStatus: 'uploaded', updatedAt: now } });
  res.status(200).json({ videoId: video._id.toString(), status: 'uploaded' });
});

export const getMomentVideoStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.videoId)) {
    unavailable(res);
    return;
  }
  const video = await getMomentVideosCollection().findOne({ _id: new ObjectId(req.params.videoId), authorUserId: userId });
  if (!video || video.deletedAt) {
    unavailable(res);
    return;
  }
  res.status(200).json({
    video: {
      id: video._id.toString(),
      processingStatus: video.processingStatus,
      durationSeconds: video.durationSeconds || null,
      width: video.width || null,
      height: video.height || null,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
    },
    message: ['rejected', 'failed'].includes(video.processingStatus) ? 'This video could not be posted. Try another video.' : null,
  });
});
