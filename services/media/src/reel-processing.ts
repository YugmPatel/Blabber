import crypto from 'crypto';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { logger } from '@repo/utils';
import { getDatabase } from './db';
import { getReelsCollection, ReelDocument, ReelHlsSegment, ReelProcessingStatus } from './models/reel';
import { getMomentVideosCollection, MomentVideoDocument } from './models/moment-video';
import {
  REEL_ERROR_MESSAGE,
  REEL_MAX_BITRATE,
  REEL_MAX_DIMENSION,
  REEL_MAX_DURATION_SECONDS,
  REEL_MAX_FRAME_RATE,
  REEL_MIN_DURATION_SECONDS,
  REEL_PROCESSING_TIMEOUT_MS,
  REEL_PROCESSOR_BATCH_SIZE,
  REEL_PROCESSOR_INTERVAL_MS,
} from './reel-constants';

const execFileAsync = promisify(execFile);
const MEDIA_ROOT = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
const REEL_STALE_PROCESSING_MS = Math.max(
  REEL_PROCESSING_TIMEOUT_MS * 2,
  Number(process.env.REEL_STALE_PROCESSING_MS || 0) || 5 * 60 * 1000
);

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  r_frame_rate?: string;
};

function isSafeMediaPath(path: string) {
  return path === MEDIA_ROOT || path.startsWith(`${MEDIA_ROOT}/`);
}

async function runTool(file: string, args: string[], timeout = REEL_PROCESSING_TIMEOUT_MS) {
  try {
    return await execFileAsync(file, args, { timeout, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error('processor_failed');
  }
}

function frameRate(value?: string) {
  if (!value || !value.includes('/')) return 0;
  const [left, right] = value.split('/').map(Number);
  if (!left || !right) return 0;
  return left / right;
}

function parseDuration(format: any, video: ProbeStream) {
  const duration = Number(video.duration || format?.duration || 0);
  return Number.isFinite(duration) ? duration : 0;
}

async function probeSource(path: string) {
  const { stdout } = await runTool('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ], 15_000);
  let parsed: { streams?: ProbeStream[]; format?: any };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('invalid_probe');
  }
  const streams = parsed.streams || [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const unsupported = streams.filter((stream) => !['video', 'audio'].includes(String(stream.codec_type || '')));
  if (videoStreams.length !== 1) throw new Error('invalid_video_stream_count');
  if (audioStreams.length > 1) throw new Error('invalid_audio_stream_count');
  if (unsupported.length) throw new Error('unsupported_stream');
  const video = videoStreams[0];
  const audio = audioStreams[0];
  if (video.codec_name !== 'h264') throw new Error('unsupported_video_codec');
  if (audio && audio.codec_name !== 'aac') throw new Error('unsupported_audio_codec');
  const duration = parseDuration(parsed.format, video);
  if (duration < REEL_MIN_DURATION_SECONDS || duration > REEL_MAX_DURATION_SECONDS) throw new Error('duration_out_of_bounds');
  const width = Number(video.width || 0);
  const height = Number(video.height || 0);
  if (!width || !height || width > REEL_MAX_DIMENSION || height > REEL_MAX_DIMENSION) throw new Error('dimensions_out_of_bounds');
  if (frameRate(video.r_frame_rate) > REEL_MAX_FRAME_RATE) throw new Error('frame_rate_out_of_bounds');
  const bitrate = Number(video.bit_rate || parsed.format?.bit_rate || 0);
  if (bitrate && bitrate > REEL_MAX_BITRATE) throw new Error('bitrate_out_of_bounds');
  return { durationSeconds: Math.round(duration * 10) / 10, width, height, hasAudio: Boolean(audio) };
}

function scaledDimensions(width: number, height: number) {
  if (height <= 720 && width <= 1280) return { width: width - (width % 2), height: height - (height % 2) };
  const ratio = Math.min(1280 / width, 720 / height);
  const nextWidth = Math.max(2, Math.floor(width * ratio));
  const nextHeight = Math.max(2, Math.floor(height * ratio));
  return { width: nextWidth - (nextWidth % 2), height: nextHeight - (nextHeight % 2) };
}

async function cleanDir(path: string) {
  if (isSafeMediaPath(path)) await fs.rm(path, { recursive: true, force: true });
  await fs.mkdir(path, { recursive: true });
}

function segmentToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function activeLeaseFilter(reel: ReelDocument, processingLeaseId: string) {
  return {
    _id: reel._id,
    processingLeaseId,
    processingStatus: { $nin: ['deleted', 'ready'] as ReelProcessingStatus[] },
    deletedAt: { $exists: false },
  };
}

function activeMomentVideoLeaseFilter(video: MomentVideoDocument, processingLeaseId: string) {
  return {
    _id: video._id,
    processingLeaseId,
    processingStatus: { $nin: ['deleted', 'ready'] as ReelProcessingStatus[] },
    deletedAt: { $exists: false },
  };
}

async function assertActiveLease(reel: ReelDocument, processingLeaseId: string) {
  const current = await getReelsCollection().findOne(activeLeaseFilter(reel, processingLeaseId));
  if (!current) throw new Error('reel_no_longer_claimed');
}

async function assertActiveMomentVideoLease(video: MomentVideoDocument, processingLeaseId: string) {
  const current = await getMomentVideosCollection().findOne(activeMomentVideoLeaseFilter(video, processingLeaseId));
  if (!current) throw new Error('moment_video_no_longer_claimed');
}

async function processReel(reel: ReelDocument, processingLeaseId: string) {
  const db = getDatabase();
  const source = await db.collection('media').findOne({
    _id: reel.sourceMediaId,
    userId: reel.authorUserId,
    status: 'approved',
    purpose: 'reel_source',
    fileType: 'video/mp4',
  });
  if (!source?.localPath || !isSafeMediaPath(source.localPath)) throw new Error('source_unavailable');

  const validating = await getReelsCollection().updateOne(
    activeLeaseFilter(reel, processingLeaseId),
    { $set: { processingStatus: 'validating', updatedAt: new Date() } }
  );
  if (!validating.matchedCount) throw new Error('reel_no_longer_claimed');
  const probe = await probeSource(source.localPath);
  const outputDir = join(MEDIA_ROOT, 'reels', reel._id.toString());
  await assertActiveLease(reel, processingLeaseId);
  await cleanDir(outputDir);
  const dims = scaledDimensions(probe.width, probe.height);
  const fallbackPath = join(outputDir, 'fallback.mp4');
  const posterPath = join(outputDir, 'poster.jpg');
  const playlistPath = join(outputDir, 'playlist.m3u8');
  const segmentPattern = join(outputDir, 'segment_%03d.ts');

  const processing = await getReelsCollection().updateOne(
    activeLeaseFilter(reel, processingLeaseId),
    { $set: { processingStatus: 'processing', updatedAt: new Date() } }
  );
  if (!processing.matchedCount) throw new Error('reel_no_longer_claimed');

  const scale = `scale=${dims.width}:${dims.height}`;
  await runTool('ffmpeg', [
    '-y', '-i', source.localPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart',
    fallbackPath,
  ]);
  await runTool('ffmpeg', [
    '-y', '-ss', '1', '-i', source.localPath,
    '-frames:v', '1', '-vf', scale,
    '-q:v', '3', '-map_metadata', '-1',
    posterPath,
  ]);
  await runTool('ffmpeg', [
    '-y', '-i', fallbackPath,
    '-c', 'copy',
    '-hls_time', '4',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', segmentPattern,
    playlistPath,
  ]);

  const files = await fs.readdir(outputDir);
  const segmentFiles = files.filter((file) => /^segment_\d+\.ts$/.test(file)).sort();
  const durationPerSegment = Math.max(1, Math.ceil(probe.durationSeconds / Math.max(1, segmentFiles.length)));
  const segments: ReelHlsSegment[] = segmentFiles.map((file) => ({
    token: segmentToken(),
    path: join(outputDir, file),
    durationSeconds: durationPerSegment,
  }));

  const now = new Date();
  const result = await getReelsCollection().findOneAndUpdate(
    activeLeaseFilter(reel, processingLeaseId),
    {
      $set: {
        processingStatus: 'ready',
        durationSeconds: probe.durationSeconds,
        width: dims.width,
        height: dims.height,
        fallbackPath,
        posterPath,
        hlsPlaylistPath: playlistPath,
        hlsSegments: segments,
        processedAt: now,
        updatedAt: now,
      },
      $unset: { validationFailureCategory: '', processingLeaseId: '' },
    },
    { returnDocument: 'after' }
  );
  if (!result) throw new Error('reel_no_longer_claimed');
}

async function processMomentVideo(video: MomentVideoDocument, processingLeaseId: string) {
  const db = getDatabase();
  const source = await db.collection('media').findOne({
    _id: video.sourceMediaId,
    userId: video.authorUserId,
    status: 'approved',
    purpose: 'moment_video_source',
    fileType: 'video/mp4',
  });
  if (!source?.localPath || !isSafeMediaPath(source.localPath)) throw new Error('source_unavailable');

  const validating = await getMomentVideosCollection().updateOne(
    activeMomentVideoLeaseFilter(video, processingLeaseId),
    { $set: { processingStatus: 'validating', updatedAt: new Date() } }
  );
  if (!validating.matchedCount) throw new Error('moment_video_no_longer_claimed');
  const probe = await probeSource(source.localPath);
  const outputDir = join(MEDIA_ROOT, 'moment-videos', video._id.toString());
  await assertActiveMomentVideoLease(video, processingLeaseId);
  await cleanDir(outputDir);
  const dims = scaledDimensions(probe.width, probe.height);
  const fallbackPath = join(outputDir, 'fallback.mp4');
  const posterPath = join(outputDir, 'poster.jpg');
  const playlistPath = join(outputDir, 'playlist.m3u8');
  const segmentPattern = join(outputDir, 'segment_%03d.ts');

  const processing = await getMomentVideosCollection().updateOne(
    activeMomentVideoLeaseFilter(video, processingLeaseId),
    { $set: { processingStatus: 'processing', updatedAt: new Date() } }
  );
  if (!processing.matchedCount) throw new Error('moment_video_no_longer_claimed');

  const scale = `scale=${dims.width}:${dims.height}`;
  await runTool('ffmpeg', [
    '-y', '-i', source.localPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart',
    fallbackPath,
  ]);
  await runTool('ffmpeg', [
    '-y', '-ss', '1', '-i', source.localPath,
    '-frames:v', '1', '-vf', scale,
    '-q:v', '3', '-map_metadata', '-1',
    posterPath,
  ]);
  await runTool('ffmpeg', [
    '-y', '-i', fallbackPath,
    '-c', 'copy',
    '-hls_time', '4',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', segmentPattern,
    playlistPath,
  ]);

  const files = await fs.readdir(outputDir);
  const segmentFiles = files.filter((file) => /^segment_\d+\.ts$/.test(file)).sort();
  const durationPerSegment = Math.max(1, Math.ceil(probe.durationSeconds / Math.max(1, segmentFiles.length)));
  const segments: ReelHlsSegment[] = segmentFiles.map((file) => ({
    token: segmentToken(),
    path: join(outputDir, file),
    durationSeconds: durationPerSegment,
  }));

  const now = new Date();
  const result = await getMomentVideosCollection().findOneAndUpdate(
    activeMomentVideoLeaseFilter(video, processingLeaseId),
    {
      $set: {
        processingStatus: 'ready',
        durationSeconds: probe.durationSeconds,
        width: dims.width,
        height: dims.height,
        fallbackPath,
        posterPath,
        hlsPlaylistPath: playlistPath,
        hlsSegments: segments,
        processedAt: now,
        updatedAt: now,
      },
      $unset: { validationFailureCategory: '', processingLeaseId: '' },
    },
    { returnDocument: 'after' }
  );
  if (!result) throw new Error('moment_video_no_longer_claimed');
}

export async function processOnePendingReel() {
  const now = new Date();
  const processingLeaseId = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - REEL_STALE_PROCESSING_MS);
  const reel = await getReelsCollection().findOneAndUpdate(
    {
      deletedAt: { $exists: false },
      publishState: { $ne: 'deleted' },
      $or: [
        { processingStatus: 'uploaded' },
        {
          processingStatus: { $in: ['validating', 'processing'] },
          processingStartedAt: { $lte: staleBefore },
        },
      ],
    },
    {
      $set: { processingStatus: 'validating', processingStartedAt: now, processingLeaseId, updatedAt: now },
      $inc: { processingAttempt: 1 },
    },
    { sort: { updatedAt: 1 }, returnDocument: 'after' }
  );
  if (!reel) return false;
  try {
    await processReel(reel, processingLeaseId);
  } catch (error) {
    logger.warn({ reelId: reel._id.toString(), category: error instanceof Error ? error.message : 'processing_failed' }, 'Reel processing failed');
    const outputDir = join(MEDIA_ROOT, 'reels', reel._id.toString());
    const stillOwned = await getReelsCollection().findOne({ _id: reel._id, processingLeaseId, deletedAt: { $exists: false } });
    if (stillOwned) await cleanDir(outputDir).catch(() => undefined);
    await getReelsCollection().updateOne(
      { _id: reel._id, processingLeaseId, processingStatus: { $ne: 'deleted' }, deletedAt: { $exists: false } },
      {
        $set: {
          processingStatus: error instanceof Error && error.message.includes('unsupported') || error instanceof Error && error.message.includes('invalid') || error instanceof Error && error.message.includes('out_of_bounds')
            ? 'rejected'
            : 'failed',
          validationFailureCategory: error instanceof Error ? error.message : 'processing_failed',
          updatedAt: new Date(),
        },
        $unset: { fallbackPath: '', posterPath: '', hlsPlaylistPath: '', hlsSegments: '', processingLeaseId: '' },
      }
    );
  }
  return true;
}

export async function processOnePendingMomentVideo() {
  const now = new Date();
  const processingLeaseId = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - REEL_STALE_PROCESSING_MS);
  const video = await getMomentVideosCollection().findOneAndUpdate(
    {
      deletedAt: { $exists: false },
      $or: [
        { processingStatus: 'uploaded' },
        {
          processingStatus: { $in: ['validating', 'processing'] },
          processingStartedAt: { $lte: staleBefore },
        },
      ],
    },
    {
      $set: { processingStatus: 'validating', processingStartedAt: now, processingLeaseId, updatedAt: now },
      $inc: { processingAttempt: 1 },
    },
    { sort: { updatedAt: 1 }, returnDocument: 'after' }
  );
  if (!video) return false;
  try {
    await processMomentVideo(video, processingLeaseId);
  } catch (error) {
    logger.warn({ videoId: video._id.toString(), category: error instanceof Error ? error.message : 'processing_failed' }, 'Moment video processing failed');
    const outputDir = join(MEDIA_ROOT, 'moment-videos', video._id.toString());
    const stillOwned = await getMomentVideosCollection().findOne({ _id: video._id, processingLeaseId, deletedAt: { $exists: false } });
    if (stillOwned) await cleanDir(outputDir).catch(() => undefined);
    await getMomentVideosCollection().updateOne(
      { _id: video._id, processingLeaseId, processingStatus: { $ne: 'deleted' }, deletedAt: { $exists: false } },
      {
        $set: {
          processingStatus: error instanceof Error && error.message.includes('unsupported') || error instanceof Error && error.message.includes('invalid') || error instanceof Error && error.message.includes('out_of_bounds')
            ? 'rejected'
            : 'failed',
          validationFailureCategory: error instanceof Error ? error.message : 'processing_failed',
          updatedAt: new Date(),
        },
        $unset: { fallbackPath: '', posterPath: '', hlsPlaylistPath: '', hlsSegments: '', processingLeaseId: '' },
      }
    );
  }
  return true;
}

export function startReelVideoProcessor() {
  if (process.env.REEL_PROCESSOR_ENABLED === 'false') return () => undefined;
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (let i = 0; i < REEL_PROCESSOR_BATCH_SIZE; i += 1) {
        const processedReel = await processOnePendingReel();
        const processedMomentVideo = await processOnePendingMomentVideo();
        if (!processedReel && !processedMomentVideo) break;
      }
    } catch (error) {
      logger.error({ error }, 'Reel processor tick failed');
    } finally {
      running = false;
    }
  };
  const interval = setInterval(tick, REEL_PROCESSOR_INTERVAL_MS);
  void tick();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

export async function deleteReelFiles(reel: Pick<ReelDocument, '_id' | 'fallbackPath' | 'posterPath' | 'hlsPlaylistPath' | 'hlsSegments'>) {
  const outputDir = join(MEDIA_ROOT, 'reels', reel._id.toString());
  await cleanDir(outputDir).catch(() => undefined);
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function deleteMomentVideoFiles(video: Pick<MomentVideoDocument, '_id' | 'fallbackPath' | 'posterPath' | 'hlsPlaylistPath' | 'hlsSegments'>) {
  const outputDir = join(MEDIA_ROOT, 'moment-videos', video._id.toString());
  await cleanDir(outputDir).catch(() => undefined);
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
}

export { REEL_ERROR_MESSAGE };
