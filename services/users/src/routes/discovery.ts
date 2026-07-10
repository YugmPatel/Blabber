import crypto from 'crypto';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { AppError, UnauthorizedError, ValidationError, asyncHandler } from '@repo/utils';
import { DISCOVERY_TOPICS, normalizeDiscoveryTopicIds, topicLabels } from '../discovery-topics';
import { getDatabase } from '../db';
import { getUsersCollection, User } from '../models/user';
import { hasBlockBetween } from '../models/user-block';
import { getProfileRelationshipsCollection } from '../models/profile-relationship';
import { getPostsCollection, PostDocument } from '../models/post';
import { getPostReactionsCollection } from '../models/post-reaction';
import { getCommunitiesCollection, CommunityDocument } from '../models/community';
import { getCommunityBansCollection } from '../models/community-ban';
import { getCommunityMembershipsCollection } from '../models/community-membership';
import {
  ensureDiscoveryPreference,
  getDiscoveryPreferencesCollection,
} from '../models/discovery-preference';
import {
  DiscoveryFeedbackTargetType,
  DiscoveryFeedbackType,
  getDiscoveryFeedbackCollection,
} from '../models/discovery-feedback';
import {
  DiscoveryDwellBucket,
  DiscoverySourceContext,
  DiscoveryTargetType,
  cleanupExpiredDiscoveryEvents,
  getDiscoveryEventsCollection,
} from '../models/discovery-event';
import { getDiscoveryCandidateTokensCollection } from '../models/discovery-candidate-token';
import {
  cleanupExpiredDiscoveryAffinities,
  getDiscoveryAffinitiesCollection,
} from '../models/discovery-affinity';
import {
  cleanupExpiredDiscoveryForYouSessions,
  getDiscoveryForYouSessionsCollection,
  ForYouExplanationSnapshot,
} from '../models/discovery-for-you-session';
import {
  clampAffinityScore,
  FOR_YOU_AFFINITY_SIGNAL_WEIGHTS,
  FOR_YOU_AFFINITY_TTL_MS,
  FOR_YOU_CANDIDATE_WINDOW_MS,
  FOR_YOU_DWELL_AFFINITY_WEIGHTS,
  FOR_YOU_MAX_CANDIDATES,
  FOR_YOU_PAGE_LIMIT,
  FOR_YOU_RANKING_MODEL_VERSION,
  FOR_YOU_RECENT_EVENT_WINDOW_MS,
  FOR_YOU_RECENT_OPEN_PENALTY_WINDOW_MS,
  FOR_YOU_SESSION_TTL_MS,
  FOR_YOU_WEIGHTS,
  freshnessScore,
} from '../for-you-ranking';

const PAGE_LIMIT = 20;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const DWELL_BUCKETS = new Set<DiscoveryDwellBucket>([
  'under_3_seconds',
  '3_to_10_seconds',
  '10_to_30_seconds',
  'over_30_seconds',
]);
const INTERACTION_EVENT_TYPES = new Set([
  'discover_post_open',
  'discover_post_dwell',
  'discover_creator_open',
  'discover_topic_open',
  'discover_community_open',
]);
const FOR_YOU_EXPLANATION_TEXT: Record<string, string> = {
  followed_creator: 'You follow this creator.',
  followed_topic: 'This post matches a topic you follow.',
  creator_affinity: 'You have shown interest in this creator.',
  topic_affinity: 'You have shown interest in this topic.',
  community_topic_interest: 'This matches topics from Communities you joined.',
  fresh_topic_post: 'This is a recent discoverable post in one of your interests.',
  new_public_post: 'This is a recent public post from a discoverable creator.',
  latest_public_post: 'Personalization is off, so this is ordered by recency.',
};

const preferencePatchSchema = z.object({ personalizedDiscoveryEnabled: z.boolean() }).strict();
const discoverySettingsSchema = z.object({
  creatorDiscoveryEnabled: z.boolean(),
  creatorTopicIds: z.array(z.string()).default([]),
}).strict();
const postDiscoverySchema = z.object({
  discoverable: z.boolean(),
  discoveryTopicIds: z.array(z.string()).default([]),
}).strict();
const communityDiscoverySchema = z.object({
  communityDiscoverable: z.boolean(),
  communityTopicIds: z.array(z.string()).default([]),
}).strict();
const eventSchema = z.object({
  eventType: z.string(),
  candidateToken: z.string().min(16).max(256),
  dwellBucket: z.string().optional(),
}).strict();

function requireUserId(req: Request) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) throw new UnauthorizedError('User not authenticated');
  return new ObjectId(userId);
}

function activeUserQuery(extra: Record<string, unknown> = {}) {
  return { ...extra, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } };
}

async function requireActiveUser(userId: ObjectId) {
  const user = await getUsersCollection().findOne(activeUserQuery({ _id: userId }) as any);
  if (!user) throw new UnauthorizedError('User not authenticated');
  return user;
}

function unavailable(): never {
  throw new AppError(404, 'This content is unavailable.', 'CONTENT_UNAVAILABLE');
}

function encodeCursor(createdAt: Date, id: ObjectId) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id: id.toString() })).toString('base64url');
}

function decodeCursor(cursor?: unknown) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(parsed.createdAt);
    if (!ObjectId.isValid(parsed.id) || Number.isNaN(createdAt.getTime())) throw new Error('bad_cursor');
    return { createdAt, id: new ObjectId(parsed.id) };
  } catch {
    throw new ValidationError('Invalid cursor.');
  }
}

function cursorFilter(cursor: ReturnType<typeof decodeCursor>, dateField = 'createdAt') {
  if (!cursor) return {};
  return {
    $or: [
      { [dateField]: { $lt: cursor.createdAt } },
      { [dateField]: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchTerm(value: unknown) {
  if (typeof value !== 'string') return null;
  const term = value.trim().slice(0, 80);
  return term.length >= 2 ? term : null;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueCandidateToken(
  viewerUserId: ObjectId,
  targetType: DiscoveryTargetType,
  targetId: ObjectId | string,
  sourceContext: DiscoverySourceContext
) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await getDiscoveryCandidateTokensCollection().insertOne({
    _id: new ObjectId(),
    tokenHash: hashToken(token),
    viewerUserId,
    targetType,
    targetId,
    sourceContext,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    consumedEventKeys: [],
  });
  return token;
}

async function feedbackTargetIds(userId: ObjectId, targetType: DiscoveryFeedbackTargetType, feedbackType: DiscoveryFeedbackType) {
  const rows = await getDiscoveryFeedbackCollection()
    .find({ userId, targetType, feedbackType })
    .project<{ targetId: ObjectId | string }>({ targetId: 1 })
    .toArray();
  return rows.map((row) => row.targetId);
}

async function hasFeedback(userId: ObjectId, targetType: DiscoveryFeedbackTargetType, targetId: ObjectId | string, feedbackType: DiscoveryFeedbackType) {
  return Boolean(await getDiscoveryFeedbackCollection().findOne({ userId, targetType, targetId, feedbackType }));
}

function creatorTopicIds(user: User) {
  return Array.isArray(user.creatorTopicIds) ? user.creatorTopicIds.filter((id) => DISCOVERY_TOPICS.some((topic) => topic.id === id)) : [];
}

async function isCreatorEligibleForViewer(creator: User, viewerUserId: ObjectId) {
  if (!creator || creator.deletedAt || creator.deactivatedAt) return false;
  if (!(creator as any).emailVerified || !creator.profileHandle || creator.profileVisibility !== 'public') return false;
  if (!creator.creatorDiscoveryEnabled || creatorTopicIds(creator).length === 0) return false;
  if (await hasBlockBetween(viewerUserId, creator._id)) return false;
  if (await hasFeedback(viewerUserId, 'creator', creator._id, 'muted')) return false;
  return true;
}

async function postMediaApproved(post: PostDocument) {
  if (!post.mediaIds.length) return true;
  const count = await getDatabase().collection('media').countDocuments({
    _id: { $in: post.mediaIds },
    userId: post.authorUserId,
    status: 'approved',
    fileType: /^image\//,
  });
  return count === post.mediaIds.length;
}

async function isDiscoverablePostForViewer(post: PostDocument, viewerUserId: ObjectId) {
  if (!post || post.deletedAt || !post.discoverable || post.visibility !== 'public') return false;
  const topicIds = Array.isArray(post.discoveryTopicIds) ? post.discoveryTopicIds : [];
  if (topicIds.length < 1 || topicIds.length > 3) return false;
  if (await hasFeedback(viewerUserId, 'post', post._id, 'not_interested')) return false;
  const author = await getUsersCollection().findOne(activeUserQuery({ _id: post.authorUserId }) as any);
  if (!author || !(await isCreatorEligibleForViewer(author, viewerUserId))) return false;
  const pref = await ensureDiscoveryPreference(viewerUserId);
  const mutedTopics = new Set(pref?.mutedTopicIds || []);
  if (topicIds.every((topicId) => mutedTopics.has(topicId as any))) return false;
  return postMediaApproved(post);
}

async function isCommunityListedForViewer(community: CommunityDocument, viewerUserId: ObjectId) {
  if (!community || community.deletedAt || !community.communityDiscoverable || community.membershipMode !== 'open') return false;
  const topicIds = Array.isArray(community.communityTopicIds) ? community.communityTopicIds : [];
  if (topicIds.length < 1 || topicIds.length > 3) return false;
  if (await hasFeedback(viewerUserId, 'community', community._id, 'muted')) return false;
  if (await getCommunityBansCollection().findOne({ communityId: community._id, userId: viewerUserId })) return false;
  const owner = await getUsersCollection().findOne(activeUserQuery({ _id: community.ownerUserId }) as any);
  if (!owner || await hasBlockBetween(viewerUserId, community.ownerUserId)) return false;
  const pref = await ensureDiscoveryPreference(viewerUserId);
  const mutedTopics = new Set(pref?.mutedTopicIds || []);
  if (topicIds.every((topicId) => mutedTopics.has(topicId as any))) return false;
  return true;
}

function publicCreator(user: User) {
  return {
    name: user.name,
    handle: user.profileHandle || null,
    displayHandle: user.profileHandle ? `@${user.profileHandle}` : null,
    avatarUrl: user.avatarUrl || null,
    topics: topicLabels(creatorTopicIds(user)),
  };
}

function pexelsAttribution(post: PostDocument) {
  if (post.importer?.provider !== 'pexels') return undefined;
  return {
    label: 'Photo via Pexels',
    creatorName: typeof post.importer.providerCreatorName === 'string' ? post.importer.providerCreatorName : null,
  };
}

async function serializeDiscoverPost(post: PostDocument, viewerUserId: ObjectId, sourceContext: DiscoverySourceContext) {
  const [author, reaction] = await Promise.all([
    getUsersCollection().findOne(activeUserQuery({ _id: post.authorUserId }) as any),
    getPostReactionsCollection().findOne({ postId: post._id, reactingUserId: viewerUserId }),
  ]);
  if (!author) return null;
  return {
    id: post._id.toString(),
    author: { id: author._id.toString(), ...publicCreator(author) },
    body: post.body || '',
    media: post.mediaIds.map((mediaId) => ({
      type: 'image',
      url: `/api/posts/${post._id.toString()}/media/${mediaId.toString()}`,
    })),
    sourceAttribution: pexelsAttribution(post),
    topics: topicLabels(post.discoveryTopicIds || []),
    commentCount: post.commentCount || 0,
    reactionCounts: post.reactionCounts || {},
    myReaction: reaction?.emoji || null,
    createdAt: post.createdAt,
    candidateToken: await issueCandidateToken(viewerUserId, 'post', post._id, sourceContext),
  };
}

async function serializeCreator(user: User, viewerUserId: ObjectId, sourceContext: DiscoverySourceContext) {
  const relationship = await getProfileRelationshipsCollection().findOne({
    followerUserId: viewerUserId,
    targetUserId: user._id,
    state: 'following',
  });
  return {
    ...publicCreator(user),
    following: Boolean(relationship),
    candidateToken: await issueCandidateToken(viewerUserId, 'creator', user._id, sourceContext),
  };
}

async function serializeCommunityListing(community: CommunityDocument, viewerUserId: ObjectId, sourceContext: DiscoverySourceContext) {
  const membership = await getCommunityMembershipsCollection().findOne({ communityId: community._id, userId: viewerUserId });
  return {
    name: community.name,
    handle: community.handle,
    description: community.description || '',
    avatarUrl: community.avatarMediaId ? `/api/communities/${community.handle}/avatar/${community.avatarMediaId.toString()}` : null,
    topics: topicLabels(community.communityTopicIds || []),
    memberCount: community.memberCount || 0,
    membership: membership ? { role: membership.role, joinedAt: membership.joinedAt } : null,
    candidateToken: await issueCandidateToken(viewerUserId, 'community', community._id, sourceContext),
  };
}

async function bumpAffinity(userId: ObjectId, affinityType: 'creator' | 'topic', affinityKey: ObjectId | string, amount: number) {
  if (amount <= 0) return;
  const now = new Date();
  const identity = { userId, surface: 'posts', affinityType, affinityKey };
  const existing = await getDiscoveryAffinitiesCollection().findOne(identity as any);
  const score = clampAffinityScore((existing?.score || 0) + amount);
  await getDiscoveryAffinitiesCollection().updateOne(
    identity as any,
    {
      $setOnInsert: {
        _id: new ObjectId(),
        userId,
        surface: 'posts',
        affinityType,
        affinityKey,
        createdAt: now,
        schemaVersion: 1,
      },
      $set: {
        score,
        lastSignalAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + FOR_YOU_AFFINITY_TTL_MS),
      },
    },
    { upsert: true }
  );
}

async function applyAffinityFromSignal(params: {
  userId: ObjectId;
  targetType: DiscoveryTargetType;
  targetId: ObjectId | string;
  eventType: string;
  topicIds?: string[];
  dwellBucket?: DiscoveryDwellBucket;
}) {
  let weights = FOR_YOU_AFFINITY_SIGNAL_WEIGHTS[params.eventType] || { creator: 0, topic: 0 };
  if (params.eventType === 'discover_post_dwell' && params.dwellBucket) {
    weights = FOR_YOU_DWELL_AFFINITY_WEIGHTS[params.dwellBucket] || weights;
  }
  const topicIds = (params.topicIds || []).filter((id) => DISCOVERY_TOPICS.some((topic) => topic.id === id));
  if (params.targetType === 'post' && ObjectId.isValid(params.targetId as any)) {
    const post = await getPostsCollection().findOne({ _id: params.targetId as ObjectId, deletedAt: { $exists: false } });
    if (!post || post.authorUserId.equals(params.userId)) return;
    await bumpAffinity(params.userId, 'creator', post.authorUserId, weights.creator);
  } else if (params.targetType === 'creator' && ObjectId.isValid(params.targetId as any)) {
    const creatorId = params.targetId as ObjectId;
    if (!creatorId.equals(params.userId)) await bumpAffinity(params.userId, 'creator', creatorId, weights.creator);
  }
  for (const topicId of topicIds) await bumpAffinity(params.userId, 'topic', topicId, weights.topic);
}

async function recordSignal(params: {
  userId: ObjectId;
  targetType: DiscoveryTargetType;
  targetId: ObjectId | string;
  eventType: string;
  sourceContext: DiscoverySourceContext;
  topicIds?: string[];
  dwellBucket?: DiscoveryDwellBucket;
}) {
  const pref = await ensureDiscoveryPreference(params.userId);
  if (!pref?.personalizedDiscoveryEnabled) return { recorded: false };
  const now = new Date();
  const windowKey = params.eventType === 'discover_post_dwell'
    ? `${Math.floor(now.getTime() / (60 * 60 * 1000))}`
    : `${Math.floor(now.getTime() / (24 * 60 * 60 * 1000))}`;
  const dedupeKey = [
    params.userId.toString(),
    params.targetType,
    params.targetId.toString(),
    params.eventType,
    params.sourceContext,
    params.dwellBucket || 'none',
    windowKey,
  ].join(':');
  const result = await getDiscoveryEventsCollection().updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        userId: params.userId,
        targetType: params.targetType,
        targetId: params.targetId,
        eventType: params.eventType,
        sourceContext: params.sourceContext,
        topicIds: params.topicIds || [],
        dwellBucket: params.dwellBucket,
        dedupeKey,
        createdAt: now,
        expiresAt: new Date(now.getTime() + EVENT_RETENTION_MS),
        schemaVersion: 1,
      },
    },
    { upsert: true }
  );
  if (result.upsertedCount) await applyAffinityFromSignal(params);
  return { recorded: Boolean(result.upsertedCount) };
}

async function assertTokenTargetEligible(token: any, viewerUserId: ObjectId) {
  if (!token || !token.viewerUserId.equals(viewerUserId) || token.expiresAt <= new Date()) unavailable();
  if (token.targetType === 'creator') {
    const user = await getUsersCollection().findOne(activeUserQuery({ _id: token.targetId }) as any);
    if (!user || !(await isCreatorEligibleForViewer(user, viewerUserId))) unavailable();
    return { topicIds: creatorTopicIds(user) };
  }
  if (token.targetType === 'post') {
    const post = await getPostsCollection().findOne({ _id: token.targetId, deletedAt: { $exists: false } });
    if (!post || !(await isDiscoverablePostForViewer(post, viewerUserId))) unavailable();
    return { topicIds: post.discoveryTopicIds || [] };
  }
  if (token.targetType === 'community') {
    const community = await getCommunitiesCollection().findOne({ _id: token.targetId, deletedAt: { $exists: false } });
    if (!community || !(await isCommunityListedForViewer(community, viewerUserId))) unavailable();
    return { topicIds: community.communityTopicIds || [] };
  }
  unavailable();
}

function encodeForYouCursor(sessionToken: string, offset: number) {
  return Buffer.from(JSON.stringify({ sessionToken, offset })).toString('base64url');
}

function decodeForYouCursor(cursor?: unknown) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed.sessionToken !== 'string' || parsed.sessionToken.length < 16) throw new Error('bad_cursor');
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > FOR_YOU_MAX_CANDIDATES) throw new Error('bad_cursor');
    return { sessionToken: parsed.sessionToken, offset: parsed.offset };
  } catch {
    throw new ValidationError('Invalid cursor.');
  }
}

async function followedCreatorIds(viewerUserId: ObjectId) {
  const rows = await getProfileRelationshipsCollection()
    .find({ followerUserId: viewerUserId, state: 'following' })
    .project<{ targetUserId: ObjectId }>({ targetUserId: 1 })
    .toArray();
  return new Set(rows.map((row) => row.targetUserId.toString()));
}

async function joinedCommunityTopicIds(viewerUserId: ObjectId) {
  const memberships = await getCommunityMembershipsCollection()
    .find({ userId: viewerUserId })
    .project<{ communityId: ObjectId }>({ communityId: 1 })
    .limit(100)
    .toArray();
  if (!memberships.length) return new Set<string>();
  const communities = await getCommunitiesCollection()
    .find({
      _id: { $in: memberships.map((membership) => membership.communityId) },
      communityDiscoverable: true,
      membershipMode: 'open',
      deletedAt: { $exists: false },
    })
    .project<{ communityTopicIds?: string[] }>({ communityTopicIds: 1 })
    .toArray();
  return new Set(communities.flatMap((community) => community.communityTopicIds || []));
}

async function loadAffinityMaps(viewerUserId: ObjectId, personalized: boolean) {
  if (!personalized) return { creators: new Map<string, number>(), topics: new Map<string, number>() };
  const rows = await getDiscoveryAffinitiesCollection()
    .find({ userId: viewerUserId, $or: [{ surface: 'posts' }, { surface: { $exists: false } }], expiresAt: { $gt: new Date() } } as any)
    .sort({ score: -1 })
    .limit(200)
    .toArray();
  return {
    creators: new Map(rows.filter((row) => row.affinityType === 'creator').map((row) => [row.affinityKey.toString(), row.score])),
    topics: new Map(rows.filter((row) => row.affinityType === 'topic').map((row) => [row.affinityKey.toString(), row.score])),
  };
}

async function recentPostSignals(viewerUserId: ObjectId) {
  const now = new Date();
  const rows = await getDiscoveryEventsCollection()
    .find({
      userId: viewerUserId,
      targetType: 'post',
      createdAt: { $gte: new Date(now.getTime() - FOR_YOU_RECENT_EVENT_WINDOW_MS) },
      eventType: { $in: ['discover_post_open', 'discover_post_dwell', 'react_to_discoverable_post', 'comment_on_discoverable_post'] },
    })
    .project<{ targetId: ObjectId | string; eventType: string; createdAt: Date }>({ targetId: 1, eventType: 1, createdAt: 1 })
    .toArray();
  const postWeights = new Map<string, number>();
  const recentOpened = new Set<string>();
  for (const event of rows) {
    const id = event.targetId.toString();
    const weight = event.eventType === 'discover_post_dwell' ? 2 : event.eventType === 'discover_post_open' ? 3 : event.eventType === 'react_to_discoverable_post' ? 4 : 6;
    postWeights.set(id, Math.min(FOR_YOU_WEIGHTS.recentPositiveMax, (postWeights.get(id) || 0) + weight));
    if (event.eventType === 'discover_post_open' && event.createdAt.getTime() >= now.getTime() - FOR_YOU_RECENT_OPEN_PENALTY_WINDOW_MS) {
      recentOpened.add(id);
    }
  }
  return { postWeights, recentOpened };
}

function primaryExplanation(params: {
  personalized: boolean;
  post: PostDocument;
  followedCreators: Set<string>;
  followedTopics: Set<string>;
  communityTopics: Set<string>;
  creatorAffinity: number;
  topTopicAffinity?: string;
}) {
  if (!params.personalized) return { code: 'latest_public_post' };
  const topics = params.post.discoveryTopicIds || [];
  if (params.followedCreators.has(params.post.authorUserId.toString())) return { code: 'followed_creator' };
  const followedTopic = topics.find((topicId) => params.followedTopics.has(topicId));
  if (followedTopic) return { code: 'followed_topic', topicId: followedTopic, topicLabel: topicLabels([followedTopic])[0]?.label };
  if (params.creatorAffinity > 0) return { code: 'creator_affinity' };
  if (params.topTopicAffinity) return { code: 'topic_affinity', topicId: params.topTopicAffinity, topicLabel: topicLabels([params.topTopicAffinity])[0]?.label };
  const communityTopic = topics.find((topicId) => params.communityTopics.has(topicId));
  if (communityTopic) return { code: 'community_topic_interest', topicId: communityTopic, topicLabel: topicLabels([communityTopic])[0]?.label };
  if (topics.length) return { code: 'fresh_topic_post', topicId: topics[0], topicLabel: topicLabels([topics[0]])[0]?.label };
  return { code: 'new_public_post' };
}

function diversifyForYou(ranked: Array<{ post: PostDocument; score: number; explanation: Omit<ForYouExplanationSnapshot, 'postId'> }>) {
  const selected: typeof ranked = [];
  const remaining = [...ranked];
  while (remaining.length && selected.length < FOR_YOU_MAX_CANDIDATES) {
    const countsByCreator = new Map<string, number>();
    const countsByTopic = new Map<string, number>();
    for (const item of selected.slice(0, FOR_YOU_PAGE_LIMIT)) {
      countsByCreator.set(item.post.authorUserId.toString(), (countsByCreator.get(item.post.authorUserId.toString()) || 0) + 1);
      for (const topicId of item.post.discoveryTopicIds || []) countsByTopic.set(topicId, (countsByTopic.get(topicId) || 0) + 1);
    }
    const previousCreator = selected[selected.length - 1]?.post.authorUserId.toString();
    let index = remaining.findIndex((item) => {
      const creatorId = item.post.authorUserId.toString();
      if (creatorId === previousCreator && remaining.length > 1) return false;
      if (selected.length < FOR_YOU_PAGE_LIMIT && (countsByCreator.get(creatorId) || 0) >= 2 && remaining.length > 3) return false;
      if (selected.length < FOR_YOU_PAGE_LIMIT && (item.post.discoveryTopicIds || []).some((topicId) => (countsByTopic.get(topicId) || 0) >= 4) && remaining.length > 5) return false;
      return true;
    });
    if (index === -1) index = 0;
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected;
}

async function buildForYouSession(viewerUserId: ObjectId, personalized: boolean) {
  const now = new Date();
  const pref = await ensureDiscoveryPreference(viewerUserId);
  const mutedTopics = new Set<string>(pref?.mutedTopicIds || []);
  const [followedCreators, communityTopics, affinityMaps, signals] = await Promise.all([
    followedCreatorIds(viewerUserId),
    joinedCommunityTopicIds(viewerUserId),
    loadAffinityMaps(viewerUserId, personalized),
    recentPostSignals(viewerUserId),
  ]);
  const followedTopics = new Set<string>(personalized ? pref?.followedTopicIds || [] : []);
  const candidates = await getPostsCollection()
    .find({
      discoverable: true,
      visibility: 'public',
      deletedAt: { $exists: false },
      authorUserId: { $ne: viewerUserId },
      createdAt: { $gte: new Date(now.getTime() - FOR_YOU_CANDIDATE_WINDOW_MS) },
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(FOR_YOU_MAX_CANDIDATES)
    .toArray();
  const ranked: Array<{ post: PostDocument; score: number; explanation: Omit<ForYouExplanationSnapshot, 'postId'> }> = [];
  for (const post of candidates) {
    if (post.authorUserId.equals(viewerUserId)) continue;
    if (!(await isDiscoverablePostForViewer(post, viewerUserId))) continue;
    const topicIds = (post.discoveryTopicIds || []).filter((topicId) => !mutedTopics.has(topicId));
    let score = personalized ? freshnessScore(post.createdAt, now) : 0;
    const authorId = post.authorUserId.toString();
    if (personalized && followedCreators.has(authorId)) score += FOR_YOU_WEIGHTS.followedCreator;
    if (personalized) {
      score += Math.min(FOR_YOU_WEIGHTS.followedTopicMax, topicIds.filter((topicId) => followedTopics.has(topicId)).length * FOR_YOU_WEIGHTS.followedTopic);
      score += Math.min(FOR_YOU_WEIGHTS.creatorAffinityMax, Math.round((affinityMaps.creators.get(authorId) || 0) * 0.3));
      const topicAffinityScores = topicIds.map((topicId) => ({ topicId, score: affinityMaps.topics.get(topicId) || 0 })).sort((a, b) => b.score - a.score);
      score += Math.min(FOR_YOU_WEIGHTS.topicAffinityMax, topicAffinityScores.reduce((total, item) => total + Math.round(item.score * 0.18), 0));
      score += Math.min(FOR_YOU_WEIGHTS.recentPositiveMax, signals.postWeights.get(post._id.toString()) || 0);
      if (!signals.recentOpened.has(post._id.toString())) score += FOR_YOU_WEIGHTS.newCreator;
      if (signals.recentOpened.has(post._id.toString())) score += FOR_YOU_WEIGHTS.recentSeenPenalty;
      const communityTopicMatches = topicIds.filter((topicId) => communityTopics.has(topicId)).length;
      score += Math.min(12, communityTopicMatches * 6);
      ranked.push({
        post,
        score,
        explanation: primaryExplanation({
          personalized,
          post,
          followedCreators,
          followedTopics,
          communityTopics,
          creatorAffinity: affinityMaps.creators.get(authorId) || 0,
          topTopicAffinity: topicAffinityScores.find((item) => item.score > 0)?.topicId,
        }),
      });
    } else {
      ranked.push({ post, score, explanation: primaryExplanation({ personalized, post, followedCreators, followedTopics, communityTopics, creatorAffinity: 0 }) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || b.post.createdAt.getTime() - a.post.createdAt.getTime() || b.post._id.toString().localeCompare(a.post._id.toString()));
  const diversified = personalized ? diversifyForYou(ranked) : ranked.slice(0, FOR_YOU_MAX_CANDIDATES);
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const refreshGeneration = await getDiscoveryForYouSessionsCollection().countDocuments({ userId: viewerUserId });
  await getDiscoveryForYouSessionsCollection().insertOne({
    _id: new ObjectId(),
    sessionHash: hashToken(sessionToken),
    userId: viewerUserId,
    rankingModelVersion: FOR_YOU_RANKING_MODEL_VERSION,
    candidatePostIds: diversified.map((item) => item.post._id),
    explanations: diversified.map((item) => ({ postId: item.post._id, ...item.explanation })),
    createdAt: now,
    expiresAt: new Date(now.getTime() + FOR_YOU_SESSION_TTL_MS),
    refreshGeneration,
    schemaVersion: 1,
  });
  return { sessionToken, sessionHash: hashToken(sessionToken), offset: 0 };
}

async function loadForYouSession(viewerUserId: ObjectId, cursor?: unknown, personalized = true) {
  const decoded = decodeForYouCursor(cursor);
  if (!decoded) return buildForYouSession(viewerUserId, personalized);
  const session = await getDiscoveryForYouSessionsCollection().findOne({
    sessionHash: hashToken(decoded.sessionToken),
    userId: viewerUserId,
    expiresAt: { $gt: new Date() },
  });
  if (!session) unavailable();
  return { sessionToken: decoded.sessionToken, sessionHash: session.sessionHash, offset: decoded.offset };
}

function explanationResponse(snapshot?: Omit<ForYouExplanationSnapshot, 'postId'> | null) {
  const code = snapshot?.code || 'new_public_post';
  return {
    code,
    text: FOR_YOU_EXPLANATION_TEXT[code] || FOR_YOU_EXPLANATION_TEXT.new_public_post,
    topicId: snapshot?.topicId || null,
    topicLabel: snapshot?.topicLabel || null,
    creatorHandle: snapshot?.creatorHandle || null,
  };
}

export async function recordDiscoverablePostEngagement(userId: ObjectId, post: PostDocument, kind: 'reaction' | 'comment') {
  if (!post || post.authorUserId.equals(userId) || !(await isDiscoverablePostForViewer(post, userId))) return { recorded: false };
  return recordSignal({
    userId,
    targetType: 'post',
    targetId: post._id,
    eventType: kind === 'reaction' ? 'react_to_discoverable_post' : 'comment_on_discoverable_post',
    sourceContext: 'discover',
    topicIds: post.discoveryTopicIds || [],
  });
}

export const listForYou = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const pref = await ensureDiscoveryPreference(viewerUserId);
  const personalized = pref?.personalizedDiscoveryEnabled !== false;
  const sessionRef = await loadForYouSession(viewerUserId, req.query.cursor, personalized);
  const session = await getDiscoveryForYouSessionsCollection().findOne({ sessionHash: sessionRef.sessionHash, userId: viewerUserId });
  if (!session) unavailable();
  const explanations = new Map(session.explanations.map((item) => [item.postId.toString(), item]));
  const posts = [];
  let nextOffset = sessionRef.offset;
  for (let index = sessionRef.offset; index < session.candidatePostIds.length && posts.length < FOR_YOU_PAGE_LIMIT; index += 1) {
    nextOffset = index + 1;
    const post = await getPostsCollection().findOne({ _id: session.candidatePostIds[index], deletedAt: { $exists: false } });
    if (!post || post.authorUserId.equals(viewerUserId) || !(await isDiscoverablePostForViewer(post, viewerUserId))) continue;
    const serialized = await serializeDiscoverPost(post, viewerUserId, 'for_you');
    if (serialized) posts.push({ ...serialized, explanation: explanationResponse(explanations.get(post._id.toString())) });
  }
  res.status(200).json({
    posts,
    nextCursor: nextOffset < session.candidatePostIds.length ? encodeForYouCursor(sessionRef.sessionToken, nextOffset) : null,
    personalized,
    rankingModelVersion: FOR_YOU_RANKING_MODEL_VERSION,
    message: personalized ? null : 'Personalization is off, so For You is ordered by recent eligible public posts.',
  });
});

export const refreshForYou = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const pref = await ensureDiscoveryPreference(viewerUserId);
  await getDiscoveryForYouSessionsCollection().deleteMany({ userId: viewerUserId, expiresAt: { $lte: new Date() } });
  const session = await buildForYouSession(viewerUserId, pref?.personalizedDiscoveryEnabled !== false);
  res.status(200).json({ cursor: encodeForYouCursor(session.sessionToken, 0), rankingModelVersion: FOR_YOU_RANKING_MODEL_VERSION });
});

export const getForYouExplanation = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID.');
  const postId = new ObjectId(req.params.postId);
  const post = await getPostsCollection().findOne({ _id: postId, deletedAt: { $exists: false } });
  if (!post || post.authorUserId.equals(viewerUserId) || !(await isDiscoverablePostForViewer(post, viewerUserId))) unavailable();
  const session = await getDiscoveryForYouSessionsCollection().findOne(
    { userId: viewerUserId, candidatePostIds: postId, expiresAt: { $gt: new Date() } },
    { sort: { createdAt: -1 } }
  );
  const explanation = session?.explanations.find((item) => item.postId.equals(postId));
  res.status(200).json({ explanation: explanationResponse(explanation) });
});

export const recordForYouEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsed = eventSchema.parse(req.body);
  if (!['discover_post_open', 'discover_post_dwell'].includes(parsed.eventType)) throw new ValidationError('Invalid discovery event.');
  if (parsed.eventType === 'discover_post_dwell' && (!parsed.dwellBucket || !DWELL_BUCKETS.has(parsed.dwellBucket as DiscoveryDwellBucket))) {
    throw new ValidationError('Invalid dwell bucket.');
  }
  if (parsed.eventType !== 'discover_post_dwell' && parsed.dwellBucket) throw new ValidationError('Invalid discovery event.');
  const token = await getDiscoveryCandidateTokensCollection().findOne({ tokenHash: hashToken(parsed.candidateToken) });
  if (!token || token.sourceContext !== 'for_you') unavailable();
  const target = await assertTokenTargetEligible(token, userId);
  const eventKey = `${parsed.eventType}:${parsed.dwellBucket || 'none'}`;
  if ((token?.consumedEventKeys || []).includes(eventKey)) {
    res.status(200).json({ recorded: false });
    return;
  }
  await getDiscoveryCandidateTokensCollection().updateOne(
    { _id: token._id },
    { $addToSet: { consumedEventKeys: eventKey } }
  );
  const result = await recordSignal({
    userId,
    targetType: token.targetType,
    targetId: token.targetId,
    eventType: parsed.eventType,
    sourceContext: 'for_you',
    topicIds: target.topicIds,
    dwellBucket: parsed.dwellBucket as DiscoveryDwellBucket | undefined,
  });
  res.status(200).json(result);
});

export const getTopics = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  res.status(200).json({ topics: DISCOVERY_TOPICS });
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const pref = await ensureDiscoveryPreference(userId);
  const [mutedCreators, mutedCommunities, hiddenPosts] = await Promise.all([
    feedbackTargetIds(userId, 'creator', 'muted'),
    feedbackTargetIds(userId, 'community', 'muted'),
    feedbackTargetIds(userId, 'post', 'not_interested'),
  ]);
  res.status(200).json({
    preferences: {
      personalizedDiscoveryEnabled: pref?.personalizedDiscoveryEnabled !== false,
      followedTopics: topicLabels(pref?.followedTopicIds || []),
      mutedTopics: topicLabels(pref?.mutedTopicIds || []),
      mutedCreatorCount: mutedCreators.length,
      mutedCommunityCount: mutedCommunities.length,
      hiddenPostCount: hiddenPosts.length,
    },
  });
});

export const updatePreferences = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsed = preferencePatchSchema.parse(req.body);
  await ensureDiscoveryPreference(userId);
  await getDiscoveryPreferencesCollection().updateOne(
    { userId },
    { $set: { personalizedDiscoveryEnabled: parsed.personalizedDiscoveryEnabled, updatedAt: new Date() } }
  );
  res.status(200).json({ preferences: (await ensureDiscoveryPreference(userId)) });
});

async function updateTopicPreference(userId: ObjectId, topicId: string, action: 'follow' | 'unfollow' | 'mute' | 'unmute') {
  if (!DISCOVERY_TOPICS.some((topic) => topic.id === topicId)) throw new ValidationError('Invalid topic.');
  await ensureDiscoveryPreference(userId);
  const update: any = { $set: { updatedAt: new Date() } };
  if (action === 'follow') {
    update.$addToSet = { followedTopicIds: topicId };
    update.$pull = { mutedTopicIds: topicId };
  } else if (action === 'unfollow') {
    update.$pull = { followedTopicIds: topicId };
  } else if (action === 'mute') {
    update.$addToSet = { mutedTopicIds: topicId };
    update.$pull = { followedTopicIds: topicId };
  } else {
    update.$pull = { mutedTopicIds: topicId };
  }
  await getDiscoveryPreferencesCollection().updateOne({ userId }, update);
  await recordSignal({
    userId,
    targetType: 'topic',
    targetId: topicId,
    eventType: `${action}_topic`,
    sourceContext: 'discover',
    topicIds: [topicId],
  });
}

export const followTopic = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  await updateTopicPreference(userId, req.params.topicId, 'follow');
  res.status(200).json({ success: true });
});

export const unfollowTopic = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  await updateTopicPreference(userId, req.params.topicId, 'unfollow');
  res.status(200).json({ success: true });
});

export const muteTopic = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  await updateTopicPreference(userId, req.params.topicId, 'mute');
  await upsertFeedback(userId, 'topic', req.params.topicId, 'muted');
  res.status(200).json({ success: true });
});

export const unmuteTopic = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  await updateTopicPreference(userId, req.params.topicId, 'unmute');
  await deleteFeedback(userId, 'topic', req.params.topicId, 'muted');
  res.status(200).json({ success: true });
});

export const updateCreatorDiscovery = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  const parsed = discoverySettingsSchema.parse(req.body);
  const topicIds = parsed.creatorDiscoveryEnabled ? normalizeTopics(parsed.creatorTopicIds, 1, 5) : normalizeOptionalTopics(parsed.creatorTopicIds, 0, 5);
  if (parsed.creatorDiscoveryEnabled) {
    if (!(user as any).emailVerified || !user.profileHandle || user.profileVisibility !== 'public') {
      throw new ValidationError('Complete your public profile details to enable Creator discovery.');
    }
  }
  const now = new Date();
  await getUsersCollection().updateOne(
    { _id: userId },
    {
      $set: {
        creatorDiscoveryEnabled: parsed.creatorDiscoveryEnabled,
        creatorTopicIds: topicIds,
        creatorDiscoveryUpdatedAt: now,
        ...(parsed.creatorDiscoveryEnabled ? { creatorDiscoveryEnabledAt: user.creatorDiscoveryEnabledAt || now } : {}),
        updatedAt: now,
      },
      ...(parsed.creatorDiscoveryEnabled ? {} : { $unset: { creatorDiscoveryEnabledAt: '' } }),
    } as any
  );
  const updated = await getUsersCollection().findOne({ _id: userId });
  res.status(200).json({ discovery: creatorDiscoverySettings(updated!) });
});

function normalizeTopics(value: unknown, min: number, max: number) {
  try {
    return normalizeDiscoveryTopicIds(value, min, max);
  } catch {
    throw new ValidationError('Invalid discovery topics.');
  }
}

function normalizeOptionalTopics(value: unknown, min: number, max: number) {
  if (!Array.isArray(value) || value.length === 0) return [];
  return normalizeTopics(value, min, max);
}

function creatorDiscoverySettings(user: User) {
  return {
    creatorDiscoveryEnabled: Boolean(user.creatorDiscoveryEnabled),
    creatorTopics: topicLabels(creatorTopicIds(user)),
    creatorDiscoveryEnabledAt: user.creatorDiscoveryEnabledAt || null,
    creatorDiscoveryUpdatedAt: user.creatorDiscoveryUpdatedAt || null,
  };
}

export const updatePostDiscovery = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID.');
  const post = await getPostsCollection().findOne({ _id: new ObjectId(req.params.postId), deletedAt: { $exists: false } });
  if (!post || !post.authorUserId.equals(userId)) unavailable();
  const parsed = postDiscoverySchema.parse(req.body);
  const topicIds = parsed.discoverable ? normalizeTopics(parsed.discoveryTopicIds, 1, 3) : normalizeOptionalTopics(parsed.discoveryTopicIds, 0, 3);
  if (parsed.discoverable) {
    if (!(await isCreatorEligibleForViewer(user, userId)) || post.visibility !== 'public' || !(await postMediaApproved(post))) {
      throw new ValidationError('This post is not eligible for Discover.');
    }
  }
  const now = new Date();
  await getPostsCollection().updateOne(
    { _id: post._id },
    { $set: { discoverable: parsed.discoverable, discoveryTopicIds: topicIds, discoverableUpdatedAt: now, updatedAt: now } }
  );
  const updated = await getPostsCollection().findOne({ _id: post._id });
  res.status(200).json({ discovery: { discoverable: Boolean(updated?.discoverable), topics: topicLabels(updated?.discoveryTopicIds || []) } });
});

export const updateCommunityDiscovery = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const community = await getCommunitiesCollection().findOne({ handle: String(req.params.handle || '').toLowerCase(), deletedAt: { $exists: false } });
  if (!community || !community.ownerUserId.equals(userId)) unavailable();
  const parsed = communityDiscoverySchema.parse(req.body);
  const topicIds = parsed.communityDiscoverable ? normalizeTopics(parsed.communityTopicIds, 1, 3) : normalizeOptionalTopics(parsed.communityTopicIds, 0, 3);
  if (parsed.communityDiscoverable && community.membershipMode !== 'open') {
    throw new ValidationError('Only open Communities can be listed in Discover.');
  }
  const now = new Date();
  await getCommunitiesCollection().updateOne(
    { _id: community._id },
    { $set: { communityDiscoverable: parsed.communityDiscoverable, communityTopicIds: topicIds, discoverableUpdatedAt: now, updatedAt: now } }
  );
  res.status(200).json({ discovery: { communityDiscoverable: parsed.communityDiscoverable, topics: topicLabels(topicIds) } });
});

export const listCreators = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const topic = typeof req.query.topic === 'string' ? req.query.topic : undefined;
  if (topic && !DISCOVERY_TOPICS.some((item) => item.id === topic)) throw new ValidationError('Invalid topic.');
  const cursor = decodeCursor(req.query.cursor);
  const pref = await ensureDiscoveryPreference(viewerUserId);
  const mutedTopics = new Set(pref?.mutedTopicIds || []);
  const query: any = activeUserQuery({
    _id: { $ne: viewerUserId },
    emailVerified: true,
    profileHandle: { $exists: true },
    profileVisibility: 'public',
    creatorDiscoveryEnabled: true,
    ...(topic ? { creatorTopicIds: topic } : {}),
    ...cursorFilter(cursor, 'creatorDiscoveryEnabledAt'),
  });
  const candidates = await getUsersCollection().find(query).sort({ creatorDiscoveryEnabledAt: -1, _id: -1 }).limit(PAGE_LIMIT * 3 + 1).toArray();
  const creators = [];
  for (const user of candidates) {
    if (creatorTopicIds(user).length === 0) continue;
    if (creatorTopicIds(user).every((id) => mutedTopics.has(id as any))) continue;
    if (await isCreatorEligibleForViewer(user, viewerUserId)) creators.push(await serializeCreator(user, viewerUserId, topic ? 'topic_browse' : 'creator_browse'));
    if (creators.length >= PAGE_LIMIT) break;
  }
  const last = candidates[Math.min(candidates.length, PAGE_LIMIT) - 1];
  res.status(200).json({ creators, nextCursor: candidates.length > PAGE_LIMIT && last ? encodeCursor(last.creatorDiscoveryEnabledAt || last.createdAt, last._id) : null });
});

export const listPosts = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const topic = typeof req.query.topic === 'string' ? req.query.topic : undefined;
  const q = searchTerm(req.query.q);
  if (topic && !DISCOVERY_TOPICS.some((item) => item.id === topic)) throw new ValidationError('Invalid topic.');
  const cursor = decodeCursor(req.query.cursor);
  const regex = q ? new RegExp(escapeRegex(q), 'i') : null;
  const query: any = {
    discoverable: true,
    visibility: 'public',
    deletedAt: { $exists: false },
    ...(topic ? { discoveryTopicIds: topic } : {}),
    ...(regex ? { $or: [{ body: regex }, { discoveryTopicIds: regex }, { 'importer.providerCreatorName': regex }] } : {}),
    ...cursorFilter(cursor),
  };
  const candidates = await getPostsCollection().find(query).sort({ createdAt: -1, _id: -1 }).limit(PAGE_LIMIT * 3 + 1).toArray();
  const posts = [];
  for (const post of candidates) {
    if (await isDiscoverablePostForViewer(post, viewerUserId)) {
      const serialized = await serializeDiscoverPost(post, viewerUserId, topic ? 'topic_browse' : 'discover');
      if (serialized) posts.push(serialized);
    }
    if (posts.length >= PAGE_LIMIT) break;
  }
  const last = candidates[Math.min(candidates.length, PAGE_LIMIT) - 1];
  res.status(200).json({ posts, nextCursor: candidates.length > PAGE_LIMIT && last ? encodeCursor(last.createdAt, last._id) : null });
});

export const listCommunities = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const topic = typeof req.query.topic === 'string' ? req.query.topic : undefined;
  if (topic && !DISCOVERY_TOPICS.some((item) => item.id === topic)) throw new ValidationError('Invalid topic.');
  const cursor = decodeCursor(req.query.cursor);
  const query: any = {
    communityDiscoverable: true,
    membershipMode: 'open',
    deletedAt: { $exists: false },
    ...(topic ? { communityTopicIds: topic } : {}),
    ...cursorFilter(cursor, 'discoverableUpdatedAt'),
  };
  const candidates = await getCommunitiesCollection().find(query).sort({ discoverableUpdatedAt: -1, _id: -1 }).limit(PAGE_LIMIT * 3 + 1).toArray();
  const communities = [];
  for (const community of candidates) {
    if (await isCommunityListedForViewer(community, viewerUserId)) {
      communities.push(await serializeCommunityListing(community, viewerUserId, topic ? 'topic_browse' : 'community_browse'));
    }
    if (communities.length >= PAGE_LIMIT) break;
  }
  const last = candidates[Math.min(candidates.length, PAGE_LIMIT) - 1];
  res.status(200).json({ communities, nextCursor: candidates.length > PAGE_LIMIT && last ? encodeCursor(last.discoverableUpdatedAt || last.createdAt, last._id) : null });
});

async function upsertFeedback(userId: ObjectId, targetType: DiscoveryFeedbackTargetType, targetId: ObjectId | string, feedbackType: DiscoveryFeedbackType) {
  const now = new Date();
  await getDiscoveryFeedbackCollection().updateOne(
    { userId, targetType, targetId, feedbackType },
    { $setOnInsert: { _id: new ObjectId(), userId, targetType, targetId, feedbackType, createdAt: now }, $set: { updatedAt: now } },
    { upsert: true }
  );
}

async function deleteFeedback(userId: ObjectId, targetType: DiscoveryFeedbackTargetType, targetId: ObjectId | string, feedbackType: DiscoveryFeedbackType) {
  await getDiscoveryFeedbackCollection().deleteOne({ userId, targetType, targetId, feedbackType });
}

export const notInterestedPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID.');
  const postId = new ObjectId(req.params.postId);
  const post = await getPostsCollection().findOne({ _id: postId, deletedAt: { $exists: false } });
  if (!post || !(await isDiscoverablePostForViewer(post, userId))) unavailable();
  await upsertFeedback(userId, 'post', postId, 'not_interested');
  await recordSignal({ userId, targetType: 'post', targetId: postId, eventType: 'not_interested_post', sourceContext: 'discover', topicIds: post.discoveryTopicIds || [] });
  res.status(200).json({ success: true });
});

export const undoNotInterestedPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID.');
  const postId = new ObjectId(req.params.postId);
  await deleteFeedback(userId, 'post', postId, 'not_interested');
  await recordSignal({ userId, targetType: 'post', targetId: postId, eventType: 'undo_not_interested_post', sourceContext: 'discover' });
  res.status(200).json({ success: true });
});

export const muteCreator = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const creator = await getUsersCollection().findOne(activeUserQuery({ profileHandle: String(req.params.handle || '').toLowerCase() }) as any);
  if (!creator || !(await isCreatorEligibleForViewer(creator, userId))) unavailable();
  await upsertFeedback(userId, 'creator', creator._id, 'muted');
  await recordSignal({ userId, targetType: 'creator', targetId: creator._id, eventType: 'mute_creator', sourceContext: 'creator_browse', topicIds: creatorTopicIds(creator) });
  res.status(200).json({ success: true });
});

export const unmuteCreator = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const creator = await getUsersCollection().findOne({ profileHandle: String(req.params.handle || '').toLowerCase() });
  if (!creator) unavailable();
  await deleteFeedback(userId, 'creator', creator._id, 'muted');
  await recordSignal({ userId, targetType: 'creator', targetId: creator._id, eventType: 'unmute_creator', sourceContext: 'creator_browse' });
  res.status(200).json({ success: true });
});

export const muteCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const community = await getCommunitiesCollection().findOne({ handle: String(req.params.handle || '').toLowerCase(), deletedAt: { $exists: false } });
  if (!community || !(await isCommunityListedForViewer(community, userId))) unavailable();
  await upsertFeedback(userId, 'community', community._id, 'muted');
  await recordSignal({ userId, targetType: 'community', targetId: community._id, eventType: 'mute_community', sourceContext: 'community_browse', topicIds: community.communityTopicIds || [] });
  res.status(200).json({ success: true });
});

export const unmuteCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const community = await getCommunitiesCollection().findOne({ handle: String(req.params.handle || '').toLowerCase() });
  if (!community) unavailable();
  await deleteFeedback(userId, 'community', community._id, 'muted');
  await recordSignal({ userId, targetType: 'community', targetId: community._id, eventType: 'unmute_community', sourceContext: 'community_browse' });
  res.status(200).json({ success: true });
});

export const recordDiscoveryEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsed = eventSchema.parse(req.body);
  if (!INTERACTION_EVENT_TYPES.has(parsed.eventType)) throw new ValidationError('Invalid discovery event.');
  if (parsed.eventType === 'discover_post_dwell' && (!parsed.dwellBucket || !DWELL_BUCKETS.has(parsed.dwellBucket as DiscoveryDwellBucket))) {
    throw new ValidationError('Invalid dwell bucket.');
  }
  if (parsed.eventType !== 'discover_post_dwell' && parsed.dwellBucket) throw new ValidationError('Invalid discovery event.');
  const token = await getDiscoveryCandidateTokensCollection().findOne({ tokenHash: hashToken(parsed.candidateToken) });
  const target = await assertTokenTargetEligible(token, userId);
  const eventKey = `${parsed.eventType}:${parsed.dwellBucket || 'none'}`;
  if ((token?.consumedEventKeys || []).includes(eventKey)) {
    res.status(200).json({ recorded: false });
    return;
  }
  await getDiscoveryCandidateTokensCollection().updateOne(
    { _id: token!._id },
    { $addToSet: { consumedEventKeys: eventKey } }
  );
  const result = await recordSignal({
    userId,
    targetType: token!.targetType,
    targetId: token!.targetId,
    eventType: parsed.eventType,
    sourceContext: token!.sourceContext,
    topicIds: target.topicIds,
    dwellBucket: parsed.dwellBucket as DiscoveryDwellBucket | undefined,
  });
  res.status(200).json(result);
});

export const clearPersonalization = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const [events, affinities, sessions, reelSessions, tokens] = await Promise.all([
    getDiscoveryEventsCollection().deleteMany({ userId }),
    getDiscoveryAffinitiesCollection().deleteMany({ userId }),
    getDiscoveryForYouSessionsCollection().deleteMany({ userId }),
    getDatabase().collection('reel_for_you_sessions').deleteMany({ userId }),
    getDiscoveryCandidateTokensCollection().deleteMany({ viewerUserId: userId }),
  ]);
  res.status(200).json({
    success: true,
    deletedSignals: events.deletedCount || 0,
    deletedAffinities: affinities.deletedCount || 0,
    deletedSessions: (sessions.deletedCount || 0) + (reelSessions.deletedCount || 0),
    deletedCandidateTokens: tokens.deletedCount || 0,
  });
});

export const runDiscoveryCleanup = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  if (!['moderator', 'admin'].includes(String(user.platformRole || ''))) throw new AppError(403, 'Forbidden', 'FORBIDDEN');
  const [deletedSignals, deletedAffinities, deletedSessions] = await Promise.all([
    cleanupExpiredDiscoveryEvents(),
    cleanupExpiredDiscoveryAffinities(),
    cleanupExpiredDiscoveryForYouSessions(),
  ]);
  res.status(200).json({ deletedSignals, deletedAffinities, deletedSessions });
});
