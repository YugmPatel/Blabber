import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig, loadJWTConfig } from '@repo/config';
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
const jwtConfig = loadJWTConfig();

// Create auth middleware
const authMiddleware = createAuthMiddleware({
  secret: jwtConfig.JWT_ACCESS_SECRET,
});

// Security middleware
app.use(helmet());

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
app.use(requestLogger('users'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'users',
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
    service: 'users',
    checks: readiness.checks,
  });
});

// User routes
import { getUserProfile } from './routes/profile';
import { searchUsers } from './routes/search';
import { updateProfile } from './routes/update-profile';
import {
  blockUser,
  getBlockRelationship,
  listBlockedUsers,
  listBlockVisibilityExclusions,
  unblockUser,
} from './routes/block';
import { getPresence } from './routes/presence';
import { createStatus, deleteStatus, listStatuses } from './routes/status';
import {
  addCloseFriend,
  createMoment,
  deleteMoment,
  getMoment,
  getMomentMedia,
  getMomentsFeed,
  listCloseFriends,
  listMomentInteractions,
  listMomentArchive,
  listMomentContacts,
  listMomentViewers,
  markMomentViewed,
  reactToMoment,
  removeMomentReaction,
  replyToMoment,
  removeCloseFriend,
  runMomentExpiryWorker,
  updateMomentArchiveSettings,
} from './routes/moments';
import { getMySettings, getPublicSettings, updateMySettings } from './routes/settings';
import {
  approveFollowRequest,
  cancelFollowRequest,
  declineFollowRequest,
  followProfile,
  getMyProfile,
  getProfileByHandle,
  listFollowers,
  listFollowing,
  listIncomingFollowRequests,
  removeFollower,
  unfollowProfile,
  updateMyHandle,
  updateMyProfile,
} from './routes/profiles';
import {
  createReport,
  getModerationReport,
  listModerationReports,
  listMyReports,
  updateModerationReport,
} from './routes/reports';
import { requirePlatformModerator } from './middleware/platform-role';

// Specific routes must come before parameterized routes
app.get('/search', searchUsers);
app.get('/settings/me', authMiddleware, getMySettings);
app.patch('/settings/me', authMiddleware, updateMySettings);
app.get('/settings/:id/public', getPublicSettings);
app.get('/profiles/me', authMiddleware, getMyProfile);
app.patch('/profiles/me', authMiddleware, updateMyProfile);
app.patch('/profiles/me/handle', authMiddleware, updateMyHandle);
app.get('/profiles/requests/incoming', authMiddleware, listIncomingFollowRequests);
app.post('/profiles/requests/:requesterHandle/approve', authMiddleware, approveFollowRequest);
app.post('/profiles/requests/:requesterHandle/decline', authMiddleware, declineFollowRequest);
app.get('/profiles/:handle/followers', authMiddleware, listFollowers);
app.get('/profiles/:handle/following', authMiddleware, listFollowing);
app.post('/profiles/:handle/follow', authMiddleware, followProfile);
app.delete('/profiles/:handle/follow', authMiddleware, unfollowProfile);
app.post('/profiles/:handle/cancel', authMiddleware, cancelFollowRequest);
app.delete('/profiles/:handle/follower', authMiddleware, removeFollower);
app.get('/profiles/:handle', authMiddleware, getProfileByHandle);
app.get('/presence/:id', getPresence);
app.get('/moments/contacts', authMiddleware, listMomentContacts);
app.get('/moments/close-friends', authMiddleware, listCloseFriends);
app.post('/moments/close-friends', authMiddleware, addCloseFriend);
app.delete('/moments/close-friends/:userId', authMiddleware, removeCloseFriend);
app.get('/moments/feed', authMiddleware, getMomentsFeed);
app.post('/moments', authMiddleware, createMoment);
app.get('/moments/archive', authMiddleware, listMomentArchive);
app.patch('/moments/archive-settings', authMiddleware, updateMomentArchiveSettings);
app.post('/moments/worker/run', authMiddleware, runMomentExpiryWorker);
app.get('/moments/:id/media', authMiddleware, getMomentMedia);
app.get('/moments/:id/interactions', authMiddleware, listMomentInteractions);
app.get('/moments/:id/viewers', authMiddleware, listMomentViewers);
app.post('/moments/:id/view', authMiddleware, markMomentViewed);
app.post('/moments/:id/reaction', authMiddleware, reactToMoment);
app.delete('/moments/:id/reaction', authMiddleware, removeMomentReaction);
app.post('/moments/:id/reply', authMiddleware, replyToMoment);
app.get('/moments/:id', authMiddleware, getMoment);
app.delete('/moments/:id', authMiddleware, deleteMoment);
app.get('/statuses', authMiddleware, listStatuses);
app.post('/statuses', authMiddleware, createStatus);
app.delete('/statuses/:id', authMiddleware, deleteStatus);
app.patch('/me', authMiddleware, updateProfile);
app.get('/blocked', authMiddleware, listBlockedUsers);
app.post('/:userId/block', authMiddleware, blockUser);
app.delete('/:userId/block', authMiddleware, unblockUser);
app.get('/blocks/relationship/:userId', authMiddleware, getBlockRelationship);
app.get('/blocks/visibility-exclusions', authMiddleware, listBlockVisibilityExclusions);
app.post('/block', authMiddleware, blockUser);
app.post('/unblock', authMiddleware, unblockUser);
app.post('/reports', authMiddleware, createReport);
app.get('/reports/mine', authMiddleware, listMyReports);
app.get('/moderation/reports', authMiddleware, requirePlatformModerator, listModerationReports);
app.get('/moderation/reports/:reportId', authMiddleware, requirePlatformModerator, getModerationReport);
app.patch('/moderation/reports/:reportId', authMiddleware, requirePlatformModerator, updateModerationReport);
app.get('/:id', getUserProfile);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('users', commonConfig.NODE_ENV));

export default app;
