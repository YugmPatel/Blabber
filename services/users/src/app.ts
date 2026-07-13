import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig, loadJWTConfig, structuredJsonParserOptions, structuredUrlEncodedParserOptions } from '@repo/config';
import {
  createAuthMiddleware,
  errorHandler,
  notFoundHandler,
  RateLimiter,
  requestIdMiddleware,
  requestLogger,
  runReadinessChecks,
} from '@repo/utils';
import { getDatabase } from './db';
import { connectToRedis } from './redis';

const app: Express = express();
const rateLimitRedis = connectToRedis();

// Discovery/safety routes are the abuse-prone surface this pass hardens —
// rate limits fail open (never block real users) if Redis has a hiccup,
// since these are a defense-in-depth layer, not core functionality.
const searchRateLimit = new RateLimiter(rateLimitRedis, {
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'ratelimit:user-search',
  failOpen: true,
}).middleware();
const profileLookupRateLimit = new RateLimiter(rateLimitRedis, {
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: 'ratelimit:profile-lookup',
  failOpen: true,
}).middleware();
const inviteCreateRateLimit = new RateLimiter(rateLimitRedis, {
  windowMs: 60_000,
  maxRequests: 5,
  keyPrefix: 'ratelimit:invite-create',
  failOpen: true,
}).middleware();
const safetyActionRateLimit = new RateLimiter(rateLimitRedis, {
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'ratelimit:safety-action',
  failOpen: true,
}).middleware();

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
    credentials: corsConfig.credentials,
  })
);

// Body parsing middleware
app.use(express.json(structuredJsonParserOptions()));
app.use(express.urlencoded(structuredUrlEncodedParserOptions()));

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
  createMomentVideoPlaybackSession,
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
  playbackMomentVideoFallback,
  playbackMomentVideoPoster,
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
  getProfileByUsername,
  listFollowers,
  listFollowing,
  listIncomingFollowRequests,
  removeFollower,
  unfollowProfile,
  updateMyHandle,
  updateMyProfile,
} from './routes/profiles';
import { getMyPrivacy, updateMyPrivacy } from './routes/privacy';
import { getMyDiscoveryInfo } from './routes/my-discovery';
import { createInvite, getInviteProfile } from './routes/invites';
import { muteUser, unmuteUser } from './routes/mute';
import {
  createReport,
  getModerationReport,
  listModerationReports,
  listMyReports,
  updateModerationReport,
} from './routes/reports';
import {
  createPost,
  createPostComment,
  deletePost,
  deletePostComment,
  getPost,
  getPostMedia,
  listFeed,
  listPostComments,
  listProfilePosts,
  listSavedPosts,
  removePostReaction,
  repostPost,
  savePost,
  setPostReaction,
  undoRepostPost,
  unsavePost,
  updatePost,
  updatePostDiscovery,
} from './routes/posts';
import {
  clearPersonalization,
  followTopic,
  getForYouExplanation,
  getPreferences as getDiscoveryPreferences,
  getTopics as getDiscoveryTopics,
  listForYou,
  listCommunities as listDiscoveryCommunities,
  listCreators as listDiscoveryCreators,
  listPosts as listDiscoveryPosts,
  muteCommunity,
  muteCreator,
  muteTopic,
  notInterestedPost,
  recordForYouEvent,
  recordDiscoveryEvent,
  refreshForYou,
  runDiscoveryCleanup,
  unfollowTopic,
  unmuteCommunity,
  unmuteCreator,
  unmuteTopic,
  undoNotInterestedPost,
  updateCommunityDiscovery,
  updateCreatorDiscovery,
  updatePreferences as updateDiscoveryPreferences,
} from './routes/discovery';
import {
  acceptInvite as acceptCommunityInvite,
  banMember as banCommunityMember,
  cancelJoinRequest as cancelCommunityJoinRequest,
  createCommunity,
  createCommunityPost,
  createCommunityPostComment,
  createInvite as createCommunityInvite,
  decideJoinRequest as decideCommunityJoinRequest,
  deleteCommunityPost,
  deleteCommunityPostComment,
  getCommunity,
  getCommunityAvatar,
  getCommunityPost,
  getCommunityPostMedia,
  joinCommunity,
  listActivity as listCommunityActivity,
  listCommunities,
  listCommunityPosts,
  listCommunityPostComments,
  listJoinRequests as listCommunityJoinRequests,
  listMembers as listCommunityMembers,
  previewInvite as previewCommunityInvite,
  removeCommunityPostReaction,
  removeMember as removeCommunityMember,
  requestJoinCommunity,
  setCommunityPostReaction,
  updateCommunity,
  updateCommunityPost,
  updateMemberRestriction as updateCommunityMemberRestriction,
  updateMemberRole as updateCommunityMemberRole,
} from './routes/communities';
import { requirePlatformModerator } from './middleware/platform-role';

// Specific routes must come before parameterized routes
app.get('/search', authMiddleware, searchRateLimit, searchUsers);
app.get('/settings/me', authMiddleware, getMySettings);
app.patch('/settings/me', authMiddleware, updateMySettings);
app.get('/settings/:id/public', getPublicSettings);
app.get('/profiles/me', authMiddleware, getMyProfile);
app.patch('/profiles/me', authMiddleware, updateMyProfile);
app.patch('/profiles/me/handle', authMiddleware, updateMyHandle);
app.patch('/profiles/me/discovery', authMiddleware, updateCreatorDiscovery);
app.get('/profiles/requests/incoming', authMiddleware, listIncomingFollowRequests);
app.post('/profiles/requests/:requesterHandle/approve', authMiddleware, approveFollowRequest);
app.post('/profiles/requests/:requesterHandle/decline', authMiddleware, declineFollowRequest);
app.get('/profiles/:handle/followers', authMiddleware, listFollowers);
app.get('/profiles/:handle/following', authMiddleware, listFollowing);
app.get('/profiles/:handle/posts', authMiddleware, listProfilePosts);
app.post('/profiles/:handle/follow', authMiddleware, followProfile);
app.delete('/profiles/:handle/follow', authMiddleware, unfollowProfile);
app.post('/profiles/:handle/cancel', authMiddleware, cancelFollowRequest);
app.delete('/profiles/:handle/follower', authMiddleware, removeFollower);
app.get('/profiles/:handle', authMiddleware, profileLookupRateLimit, getProfileByHandle);
app.get('/profile/:username', authMiddleware, profileLookupRateLimit, getProfileByUsername);
app.get('/me/privacy', authMiddleware, getMyPrivacy);
app.patch('/me/privacy', authMiddleware, updateMyPrivacy);
app.get('/me/discovery', authMiddleware, getMyDiscoveryInfo);
app.post('/invites', authMiddleware, inviteCreateRateLimit, createInvite);
app.get('/invites/:token', authMiddleware, profileLookupRateLimit, getInviteProfile);
app.post('/:userId/mute', authMiddleware, safetyActionRateLimit, muteUser);
app.delete('/:userId/mute', authMiddleware, unmuteUser);
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
app.post('/moments/:id/video/playback-session', authMiddleware, createMomentVideoPlaybackSession);
app.get('/moments/:id/video/fallback', authMiddleware, playbackMomentVideoFallback);
app.get('/moments/:id/video/poster', authMiddleware, playbackMomentVideoPoster);
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
app.get('/feed', authMiddleware, listFeed);
app.get('/posts/saved', authMiddleware, listSavedPosts);
app.get('/discovery/topics', authMiddleware, getDiscoveryTopics);
app.get('/discovery/preferences', authMiddleware, getDiscoveryPreferences);
app.patch('/discovery/preferences', authMiddleware, updateDiscoveryPreferences);
app.post('/discovery/topics/:topicId/follow', authMiddleware, followTopic);
app.delete('/discovery/topics/:topicId/follow', authMiddleware, unfollowTopic);
app.post('/discovery/topics/:topicId/mute', authMiddleware, muteTopic);
app.delete('/discovery/topics/:topicId/mute', authMiddleware, unmuteTopic);
app.get('/discovery/for-you', authMiddleware, listForYou);
app.post('/discovery/for-you/refresh', authMiddleware, refreshForYou);
app.post('/discovery/for-you/events', authMiddleware, recordForYouEvent);
app.get('/discovery/for-you/explanations/:postId', authMiddleware, getForYouExplanation);
app.get('/discovery/creators', authMiddleware, listDiscoveryCreators);
app.get('/discovery/posts', authMiddleware, listDiscoveryPosts);
app.get('/discovery/communities', authMiddleware, listDiscoveryCommunities);
app.post('/discovery/posts/:postId/not-interested', authMiddleware, notInterestedPost);
app.delete('/discovery/posts/:postId/not-interested', authMiddleware, undoNotInterestedPost);
app.post('/discovery/creators/:handle/mute', authMiddleware, muteCreator);
app.delete('/discovery/creators/:handle/mute', authMiddleware, unmuteCreator);
app.post('/discovery/communities/:handle/mute', authMiddleware, muteCommunity);
app.delete('/discovery/communities/:handle/mute', authMiddleware, unmuteCommunity);
app.post('/discovery/events', authMiddleware, recordDiscoveryEvent);
app.post('/discovery/personalization/clear', authMiddleware, clearPersonalization);
app.post('/discovery/worker/cleanup', authMiddleware, runDiscoveryCleanup);
app.get('/communities', authMiddleware, listCommunities);
app.post('/communities', authMiddleware, createCommunity);
app.get('/communities/invite/:token', authMiddleware, previewCommunityInvite);
app.post('/communities/invite/:token/accept', authMiddleware, acceptCommunityInvite);
app.get('/communities/:handle/avatar/:mediaId', authMiddleware, getCommunityAvatar);
app.get('/communities/:handle/posts', authMiddleware, listCommunityPosts);
app.post('/communities/:handle/posts', authMiddleware, createCommunityPost);
app.post('/communities/:handle/join', authMiddleware, joinCommunity);
app.post('/communities/:handle/request', authMiddleware, requestJoinCommunity);
app.delete('/communities/:handle/request', authMiddleware, cancelCommunityJoinRequest);
app.get('/communities/:handle/requests', authMiddleware, listCommunityJoinRequests);
app.post('/communities/:handle/requests/:requestUserId/approve', authMiddleware, decideCommunityJoinRequest);
app.post('/communities/:handle/requests/:requestUserId/decline', authMiddleware, decideCommunityJoinRequest);
app.get('/communities/:handle/members', authMiddleware, listCommunityMembers);
app.patch('/communities/:handle/members/:memberUserId/role', authMiddleware, updateCommunityMemberRole);
app.patch('/communities/:handle/members/:memberUserId/restriction', authMiddleware, updateCommunityMemberRestriction);
app.delete('/communities/:handle/members/:memberUserId', authMiddleware, removeCommunityMember);
app.post('/communities/:handle/members/:memberUserId/ban', authMiddleware, banCommunityMember);
app.get('/communities/:handle/activity', authMiddleware, listCommunityActivity);
app.post('/communities/:handle/invite', authMiddleware, createCommunityInvite);
app.get('/communities/:handle', authMiddleware, getCommunity);
app.patch('/communities/:handle', authMiddleware, updateCommunity);
app.patch('/communities/:handle/discovery', authMiddleware, updateCommunityDiscovery);
app.get('/community-posts/:postId/media/:mediaId', authMiddleware, getCommunityPostMedia);
app.post('/community-posts/:postId/reaction', authMiddleware, setCommunityPostReaction);
app.delete('/community-posts/:postId/reaction', authMiddleware, removeCommunityPostReaction);
app.get('/community-posts/:postId/comments', authMiddleware, listCommunityPostComments);
app.post('/community-posts/:postId/comments', authMiddleware, createCommunityPostComment);
app.delete('/community-posts/:postId/comments/:commentId', authMiddleware, deleteCommunityPostComment);
app.post('/community-posts/:postId/comments/:commentId/report', authMiddleware, (req, res, next) => {
  req.body = { ...req.body, targetType: 'community_comment', targetId: req.params.commentId };
  createReport(req, res, next);
});
app.post('/community-posts/:postId/report', authMiddleware, (req, res, next) => {
  req.body = { ...req.body, targetType: 'community_post', targetId: req.params.postId };
  createReport(req, res, next);
});
app.get('/community-posts/:postId', authMiddleware, getCommunityPost);
app.patch('/community-posts/:postId', authMiddleware, updateCommunityPost);
app.delete('/community-posts/:postId', authMiddleware, deleteCommunityPost);
app.post('/posts', authMiddleware, createPost);
app.get('/posts/:postId/media/:mediaId', authMiddleware, getPostMedia);
app.post('/posts/:postId/reaction', authMiddleware, setPostReaction);
app.delete('/posts/:postId/reaction', authMiddleware, removePostReaction);
app.post('/posts/:postId/save', authMiddleware, savePost);
app.delete('/posts/:postId/save', authMiddleware, unsavePost);
app.post('/posts/:postId/repost', authMiddleware, repostPost);
app.delete('/posts/:postId/repost', authMiddleware, undoRepostPost);
app.get('/posts/:postId/comments', authMiddleware, listPostComments);
app.post('/posts/:postId/comments', authMiddleware, createPostComment);
app.delete('/posts/:postId/comments/:commentId', authMiddleware, deletePostComment);
app.post('/posts/:postId/comments/:commentId/report', authMiddleware, (req, res, next) => {
  req.body = { ...req.body, targetType: 'post_comment', targetId: req.params.commentId };
  createReport(req, res, next);
});
app.post('/posts/:postId/report', authMiddleware, (req, res, next) => {
  req.body = { ...req.body, targetType: 'post', targetId: req.params.postId };
  createReport(req, res, next);
});
app.get('/posts/:postId', authMiddleware, getPost);
app.patch('/posts/:postId', authMiddleware, updatePost);
app.patch('/posts/:postId/discovery', authMiddleware, updatePostDiscovery);
app.delete('/posts/:postId', authMiddleware, deletePost);
app.get('/blocked', authMiddleware, listBlockedUsers);
app.post('/:userId/block', authMiddleware, safetyActionRateLimit, blockUser);
app.delete('/:userId/block', authMiddleware, unblockUser);
app.get('/blocks/relationship/:userId', authMiddleware, getBlockRelationship);
app.get('/blocks/visibility-exclusions', authMiddleware, listBlockVisibilityExclusions);
app.post('/block', authMiddleware, safetyActionRateLimit, blockUser);
app.post('/unblock', authMiddleware, unblockUser);
app.post('/reports', authMiddleware, safetyActionRateLimit, createReport);
app.get('/reports/mine', authMiddleware, listMyReports);
app.get('/moderation/reports', authMiddleware, requirePlatformModerator, listModerationReports);
app.get('/moderation/reports/:reportId', authMiddleware, requirePlatformModerator, getModerationReport);
app.patch('/moderation/reports/:reportId', authMiddleware, requirePlatformModerator, updateModerationReport);
app.get('/:id', authMiddleware, profileLookupRateLimit, getUserProfile);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('users', commonConfig.NODE_ENV));

export default app;
