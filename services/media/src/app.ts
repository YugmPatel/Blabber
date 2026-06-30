import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig } from '@repo/config';
import {
  createAuthMiddleware,
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLogger,
  runReadinessChecks,
} from '@repo/utils';
import { getDatabase } from './db';
import { connectToRedis } from './redis';

const app: Express = express();

// Load configuration
const commonConfig = loadCommonConfig();
const corsConfig = loadCORSConfig();
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;

if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
  throw new Error('Invalid JWT_ACCESS_SECRET configuration');
}

const authMiddleware = createAuthMiddleware({
  secret: jwtAccessSecret,
});

// Security middleware. Local media is intentionally served to the web app from a
// different localhost origin during development.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS middleware
app.use(
  cors({
    origin: corsConfig.origins,
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(requestIdMiddleware);
app.use(requestLogger('media'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'media',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const readiness = await runReadinessChecks([
    { name: 'mongo', check: () => getDatabase().command({ ping: 1 }).then(() => undefined) },
    { name: 'redis', check: () => connectToRedis().ping().then(() => undefined) },
  ]);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'media',
    checks: readiness.checks,
  });
});

// Media routes
import { getLocalMedia, presign, uploadLocalMedia, uploadMultipartMedia } from './routes/presign';
import { linkPreview } from './routes/link-preview';
import {
  createReelComment,
  createReelEventToken,
  createPlaybackSession,
  deleteReel,
  deleteReelComment,
  getReel,
  getReelStatus,
  initiateReelUpload,
  listReelComments,
  listReelsBrowse,
  listProfileReels,
  listReelsForYou,
  listSavedReels,
  muteReelCreator,
  notInterestedReel,
  playbackFallback,
  playbackManifest,
  playbackPoster,
  playbackSegment,
  publishReel,
  recordReelEvent,
  removeReelReaction,
  reportReelComment,
  reportReel,
  refreshReelsForYou,
  saveReel,
  setReelReaction,
  undoNotInterestedReel,
  unsaveReel,
  updateReelDiscovery,
  updateReel,
  uploadReelSource,
  getReelsForYouExplanation,
} from './routes/reels';
app.post('/presign', authMiddleware, presign);
app.post('/upload', authMiddleware, express.raw({ type: 'multipart/form-data', limit: '50mb' }), uploadMultipartMedia);
app.put('/local/:id', authMiddleware, express.raw({ type: '*/*', limit: '50mb' }), uploadLocalMedia);
app.get('/local/:id', getLocalMedia);
app.get('/link-preview', linkPreview);
app.post('/reels/upload-init', authMiddleware, initiateReelUpload);
app.put('/reels/uploads/:reelId/source', authMiddleware, express.raw({ type: '*/*', limit: '110mb' }), uploadReelSource);
app.post('/reels', authMiddleware, publishReel);
app.get('/reels/browse', authMiddleware, listReelsBrowse);
app.get('/reels/for-you', authMiddleware, listReelsForYou);
app.post('/reels/for-you/refresh', authMiddleware, refreshReelsForYou);
app.get('/reels/for-you/explanations/:reelId', authMiddleware, getReelsForYouExplanation);
app.get('/reels/saved', authMiddleware, listSavedReels);
app.get('/reels/:reelId/status', authMiddleware, getReelStatus);
app.patch('/reels/:reelId/discovery', authMiddleware, updateReelDiscovery);
app.post('/reels/:reelId/playback-session', authMiddleware, createPlaybackSession);
app.post('/reels/:reelId/event-token', authMiddleware, createReelEventToken);
app.post('/reels/:reelId/events', authMiddleware, recordReelEvent);
app.post('/reels/:reelId/reaction', authMiddleware, setReelReaction);
app.delete('/reels/:reelId/reaction', authMiddleware, removeReelReaction);
app.get('/reels/:reelId/comments', authMiddleware, listReelComments);
app.post('/reels/:reelId/comments', authMiddleware, createReelComment);
app.delete('/reels/:reelId/comments/:commentId', authMiddleware, deleteReelComment);
app.post('/reels/:reelId/save', authMiddleware, saveReel);
app.delete('/reels/:reelId/save', authMiddleware, unsaveReel);
app.post('/reels/:reelId/not-interested', authMiddleware, notInterestedReel);
app.delete('/reels/:reelId/not-interested', authMiddleware, undoNotInterestedReel);
app.post('/reels/:reelId/mute-creator', authMiddleware, muteReelCreator);
app.get('/reels/playback/:sessionToken/manifest', authMiddleware, playbackManifest);
app.get('/reels/playback/:sessionToken/segment/:segmentToken', authMiddleware, playbackSegment);
app.get('/reels/playback/:sessionToken/fallback', authMiddleware, playbackFallback);
app.get('/reels/playback/:sessionToken/poster', authMiddleware, playbackPoster);
app.post('/reels/:reelId/report', authMiddleware, reportReel);
app.post('/reels/:reelId/comments/:commentId/report', authMiddleware, reportReelComment);
app.get('/reels/:reelId', authMiddleware, getReel);
app.patch('/reels/:reelId', authMiddleware, updateReel);
app.delete('/reels/:reelId', authMiddleware, deleteReel);
app.get('/profiles/:handle/reels', authMiddleware, listProfileReels);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('media', commonConfig.NODE_ENV));

export default app;
