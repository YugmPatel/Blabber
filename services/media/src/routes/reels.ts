import crypto from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { dirname, join } from 'path';
import axios from 'axios';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { asyncHandler } from '@repo/utils';
import { getDatabase } from '../db';
import { scanBuffer } from '../media-scanner';
import { sanitizeDisplayFileName, safeExtension } from '../media-policy';
import { getMediaCollection } from '../models/media';
import { getReelsCollection, ReelDocument } from '../models/reel';
import { getReelPlaybackSessionsCollection } from '../models/reel-playback-session';
import {
  getReelForYouSessionsCollection,
  ReelForYouExplanationSnapshot,
} from '../models/reel-for-you-session';
import {
  getReelCommentsCollection,
  getReelNotificationCooldownsCollection,
  getReelReactionsCollection,
  getReelSavesCollection,
  REEL_REACTION_EMOJIS,
  ReelReactionEmoji,
} from '../models/reel-interaction';
import {
  REEL_CAPTION_LIMIT,
  REEL_EDIT_WINDOW_MS,
  REEL_ERROR_MESSAGE,
  REEL_MAX_SOURCE_BYTES,
  REEL_PLAYBACK_SESSION_TTL_MS,
  REEL_UNAVAILABLE_MESSAGE,
} from '../reel-constants';
import { deleteReelFiles } from '../reel-processing';
import {
  clampReelAffinityScore,
  REEL_AFFINITY_SIGNAL_WEIGHTS,
  REEL_COMPLETION_AFFINITY_WEIGHTS,
  REEL_FOR_YOU_AFFINITY_TTL_MS,
  REEL_FOR_YOU_CANDIDATE_WINDOW_MS,
  REEL_FOR_YOU_EXPLANATION_TEXT,
  REEL_FOR_YOU_MAX_CANDIDATES,
  REEL_FOR_YOU_PAGE_LIMIT,
  REEL_FOR_YOU_RANKING_MODEL_VERSION,
  REEL_FOR_YOU_RECENT_EVENT_WINDOW_MS,
  REEL_FOR_YOU_RECENT_OPEN_SUPPRESS_MS,
  REEL_FOR_YOU_SESSION_TTL_MS,
  REEL_FOR_YOU_WEIGHTS,
  REEL_WATCH_AFFINITY_WEIGHTS,
  reelFreshnessScore,
} from '../reel-for-you-ranking';

const MEDIA_ROOT = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
const PAGE_LIMIT = 20;
const EVENT_TOKEN_TTL_MS = 15 * 60 * 1000;
const EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;
const NOTIFICATIONS_SERVICE_URL = (process.env.NOTIFICATIONS_SERVICE_URL || 'http://notifications:3006').replace(/\/+$/, '');
const TOPICS = new Set([
  'technology', 'artificial_intelligence', 'software_engineering', 'startups', 'business', 'finance', 'education', 'careers',
  'design', 'gaming', 'sports', 'fitness', 'health', 'food', 'travel', 'photography', 'music', 'film', 'books', 'science',
  'parenting', 'pets', 'home', 'fashion', 'comedy',
]);

const uploadInitSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  fileType: z.string().trim().toLowerCase(),
  fileSize: z.number().int().positive().max(REEL_MAX_SOURCE_BYTES),
}).strict();

const publishSchema = z.object({
  reelId: z.string().refine(ObjectId.isValid),
  caption: z.string().max(REEL_CAPTION_LIMIT).default(''),
  visibility: z.enum(['public', 'followers']).default('followers'),
  topicIds: z.array(z.string()).max(3).default([]),
}).strict();

const editSchema = z.object({
  caption: z.string().max(REEL_CAPTION_LIMIT),
}).strict();

const discoverySchema = z.object({
  reelDiscoverable: z.boolean(),
  reelTopicIds: z.array(z.string()).default([]),
}).strict();

const reactionSchema = z.object({
  emoji: z.enum(REEL_REACTION_EMOJIS),
}).strict();

const commentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
}).strict();

const watchEventSchema = z.object({
  eventType: z.enum(['reel_open', 'reel_watch_bucket', 'reel_completion_bucket', 'reel_quick_skip']),
  eventToken: z.string().min(16).max(256),
  watchBucket: z.enum(['under_3_seconds', '3_to_10_seconds', '10_to_30_seconds', '30_to_60_seconds', 'over_60_seconds']).optional(),
  completionBucket: z.enum(['under_25_percent', '25_to_50_percent', '50_to_75_percent', '75_to_95_percent', 'over_95_percent']).optional(),
  skipReason: z.enum(['user_next_reel']).optional(),
}).strict();

const reportSchema = z.object({
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().max(1000).optional(),
}).strict();

function requireUserId(req: Request) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    const error: any = new Error('User not authenticated');
    error.statusCode = 401;
    throw error;
  }
  return new ObjectId(userId);
}

function unavailable(res: Response) {
  res.status(404).json({ error: 'Not Found', message: REEL_UNAVAILABLE_MESSAGE });
}

function validationError(res: Response, message = REEL_ERROR_MESSAGE) {
  res.status(400).json({ error: 'Validation Error', message });
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function encodeForYouCursor(sessionToken: string, offset: number) {
  return Buffer.from(JSON.stringify({ sessionToken, offset })).toString('base64url');
}

function decodeForYouCursor(cursor?: unknown) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed.sessionToken !== 'string' || parsed.sessionToken.length < 16) throw new Error('bad_cursor');
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > REEL_FOR_YOU_MAX_CANDIDATES) throw new Error('bad_cursor');
    return { sessionToken: parsed.sessionToken, offset: parsed.offset };
  } catch {
    const error: any = new Error('Invalid cursor.');
    error.statusCode = 400;
    throw error;
  }
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
    const error: any = new Error('Invalid cursor.');
    error.statusCode = 400;
    throw error;
  }
}

function cursorFilter(cursor: ReturnType<typeof decodeCursor>, dateField = 'publishedAt') {
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

function activeUserQuery(extra: Record<string, unknown> = {}) {
  return { ...extra, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } };
}

async function requireActiveUser(userId: ObjectId) {
  const user = await getDatabase().collection('users').findOne(activeUserQuery({ _id: userId }) as any);
  if (!user) {
    const error: any = new Error('User not authenticated');
    error.statusCode = 401;
    throw error;
  }
  return user;
}

async function hasBlockBetween(a: ObjectId, b: ObjectId) {
  return Boolean(await getDatabase().collection('user_blocks').findOne({
    $or: [
      { blockerUserId: a, blockedUserId: b },
      { blockerUserId: b, blockedUserId: a },
    ],
  }));
}

async function isFollowing(followerUserId: ObjectId, targetUserId: ObjectId) {
  return Boolean(await getDatabase().collection('profile_relationships').findOne({ followerUserId, targetUserId, state: 'following' }));
}

async function canAccessReel(reel: ReelDocument, viewerUserId: ObjectId, includeOwnerDraft = false) {
  if (!reel || reel.deletedAt || reel.publishState === 'deleted' || reel.moderationRemovedAt) return false;
  const isOwner = reel.authorUserId.equals(viewerUserId);
  if (!isOwner && reel.publishState !== 'published') return false;
  if (!isOwner && reel.processingStatus !== 'ready') return false;
  if (includeOwnerDraft && isOwner) return true;
  const [viewer, author] = await Promise.all([
    getDatabase().collection('users').findOne(activeUserQuery({ _id: viewerUserId }) as any),
    getDatabase().collection('users').findOne(activeUserQuery({ _id: reel.authorUserId }) as any),
  ]);
  if (!viewer || !author || await hasBlockBetween(viewerUserId, reel.authorUserId)) return false;
  if (isOwner) return true;
  const profileVisibility = author.profileVisibility || 'private';
  if (profileVisibility === 'private') return isFollowing(viewerUserId, reel.authorUserId);
  if (reel.visibility === 'public') return true;
  return isFollowing(viewerUserId, reel.authorUserId);
}

function normalizeCaption(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function normalizeTopics(value: string[]) {
  const unique = Array.from(new Set(value.filter((item) => TOPICS.has(item))));
  if (unique.length !== value.length) throw new Error('invalid_topics');
  return unique;
}

function topicLabels(ids: string[]) {
  return ids.filter((id) => TOPICS.has(id)).map((id) => ({
    id,
    label: id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  }));
}

async function mediaApprovedForReel(reel: ReelDocument) {
  if (!reel.fallbackPath || !reel.posterPath || !(reel.hlsSegments || []).length) return false;
  const media = await getMediaCollection().findOne({
    _id: reel.sourceMediaId,
    userId: reel.authorUserId,
    status: 'approved',
    purpose: 'reel_source',
  });
  return Boolean(media);
}

async function isCreatorEligible(author: any, viewerUserId: ObjectId) {
  if (!author || author.deletedAt || author.deactivatedAt) return false;
  if (!author.emailVerified || !author.profileHandle || author.profileVisibility !== 'public') return false;
  if (!author.creatorDiscoveryEnabled) return false;
  if (await hasBlockBetween(viewerUserId, author._id)) return false;
  const muted = await getDatabase().collection('discovery_feedback').findOne({
    userId: viewerUserId,
    targetType: 'creator',
    targetId: author._id,
    feedbackType: 'muted',
  });
  return !muted;
}

async function isBrowseEligibleForViewer(reel: ReelDocument, viewerUserId: ObjectId) {
  if (!reel?.reelDiscoverable || reel.visibility !== 'public' || reel.publishState !== 'published' || reel.processingStatus !== 'ready') return false;
  if (reel.deletedAt || reel.moderationRemovedAt) return false;
  const topicIds = Array.isArray(reel.reelTopicIds) ? reel.reelTopicIds.filter((topicId) => TOPICS.has(topicId)) : [];
  if (topicIds.length < 1 || topicIds.length > 3) return false;
  const [viewer, author, hidden, pref] = await Promise.all([
    getDatabase().collection('users').findOne(activeUserQuery({ _id: viewerUserId }) as any),
    getDatabase().collection('users').findOne(activeUserQuery({ _id: reel.authorUserId }) as any),
    getDatabase().collection('discovery_feedback').findOne({ userId: viewerUserId, targetType: 'reel', targetId: reel._id, feedbackType: 'not_interested' }),
    getDatabase().collection('discovery_preferences').findOne({ userId: viewerUserId }),
  ]);
  if (!viewer || hidden || !(await isCreatorEligible(author, viewerUserId))) return false;
  const mutedTopics = new Set(pref?.mutedTopicIds || []);
  if (topicIds.every((topicId) => mutedTopics.has(topicId))) return false;
  return (await canAccessReel(reel, viewerUserId)) && (await mediaApprovedForReel(reel));
}

async function currentInteractionState(reel: ReelDocument, viewerUserId: ObjectId) {
  const [reaction, save] = await Promise.all([
    getReelReactionsCollection().findOne({ reelId: reel._id, reactingUserId: viewerUserId }),
    getReelSavesCollection().findOne({ reelId: reel._id, userId: viewerUserId }),
  ]);
  return { myReaction: reaction?.emoji || null, saved: Boolean(save) };
}

async function followedCreatorIds(viewerUserId: ObjectId) {
  const rows = await getDatabase().collection('profile_relationships')
    .find({ followerUserId: viewerUserId, state: 'following' })
    .project<{ targetUserId: ObjectId }>({ targetUserId: 1 })
    .limit(500)
    .toArray();
  return new Set(rows.map((row) => row.targetUserId.toString()));
}

async function joinedOpenCommunityTopicIds(viewerUserId: ObjectId) {
  const memberships = await getDatabase().collection('community_memberships')
    .find({ userId: viewerUserId })
    .project<{ communityId: ObjectId }>({ communityId: 1 })
    .limit(100)
    .toArray();
  if (!memberships.length) return new Set<string>();
  const communities = await getDatabase().collection('communities')
    .find({
      _id: { $in: memberships.map((membership) => membership.communityId) },
      communityDiscoverable: true,
      membershipMode: 'open',
      deletedAt: { $exists: false },
    })
    .project<{ communityTopicIds?: string[] }>({ communityTopicIds: 1 })
    .limit(100)
    .toArray();
  return new Set(communities.flatMap((community) => community.communityTopicIds || []).filter((topicId) => TOPICS.has(topicId)));
}

async function loadReelAffinityMaps(viewerUserId: ObjectId, personalized: boolean) {
  if (!personalized) return { creators: new Map<string, number>(), topics: new Map<string, number>() };
  const rows = await getDatabase().collection('discovery_affinities')
    .find({ userId: viewerUserId, surface: 'reels', expiresAt: { $gt: new Date() } })
    .sort({ score: -1 })
    .limit(200)
    .toArray();
  return {
    creators: new Map(rows.filter((row) => row.affinityType === 'creator').map((row) => [row.affinityKey.toString(), Number(row.score || 0)])),
    topics: new Map(rows.filter((row) => row.affinityType === 'topic').map((row) => [row.affinityKey.toString(), Number(row.score || 0)])),
  };
}

async function recentReelSignals(viewerUserId: ObjectId) {
  const now = new Date();
  const rows = await getDatabase().collection('discovery_events')
    .find({
      userId: viewerUserId,
      targetType: 'reel',
      createdAt: { $gte: new Date(now.getTime() - REEL_FOR_YOU_RECENT_EVENT_WINDOW_MS) },
      eventType: { $in: ['reel_open', 'reel_watch_bucket', 'reel_completion_bucket', 'reel_quick_skip', 'react_to_discoverable_reel', 'comment_on_discoverable_reel', 'save_discoverable_reel'] },
    })
    .project<{ targetId: ObjectId | string; eventType: string; dwellBucket?: string; createdAt: Date }>({ targetId: 1, eventType: 1, dwellBucket: 1, createdAt: 1 })
    .toArray();
  const reelWeights = new Map<string, number>();
  const recentOpened = new Set<string>();
  const quickSkipped = new Set<string>();
  for (const event of rows) {
    const id = event.targetId.toString();
    const positive = event.eventType === 'reel_open'
      ? 3
      : event.eventType === 'reel_watch_bucket'
        ? 2
        : event.eventType === 'reel_completion_bucket'
          ? 4
          : event.eventType === 'react_to_discoverable_reel'
            ? 4
            : event.eventType === 'comment_on_discoverable_reel'
              ? 6
              : event.eventType === 'save_discoverable_reel'
                ? 8
                : 0;
    if (positive) reelWeights.set(id, Math.min(REEL_FOR_YOU_WEIGHTS.recentPositiveMax, (reelWeights.get(id) || 0) + positive));
    if (event.eventType === 'reel_open' && event.createdAt.getTime() >= now.getTime() - REEL_FOR_YOU_RECENT_OPEN_SUPPRESS_MS) recentOpened.add(id);
    if (event.eventType === 'reel_quick_skip') quickSkipped.add(id);
  }
  return { reelWeights, recentOpened, quickSkipped };
}

function explanationResponse(snapshot?: Omit<ReelForYouExplanationSnapshot, 'reelId'> | null) {
  const code = snapshot?.code || 'new_public_reel';
  return {
    code,
    text: REEL_FOR_YOU_EXPLANATION_TEXT[code] || REEL_FOR_YOU_EXPLANATION_TEXT.new_public_reel,
    topicId: snapshot?.topicId || null,
    topicLabel: snapshot?.topicLabel || null,
    creatorHandle: snapshot?.creatorHandle || null,
  };
}

function pexelsAttribution(reel: ReelDocument) {
  if (reel.importer?.provider !== 'pexels') return undefined;
  return {
    label: 'Video via Pexels',
    creatorName: typeof reel.importer.providerCreatorName === 'string' ? reel.importer.providerCreatorName : null,
  };
}

function primaryReelExplanation(params: {
  personalized: boolean;
  reel: ReelDocument;
  author?: any;
  followedCreators: Set<string>;
  followedTopics: Set<string>;
  creatorAffinity: number;
  topTopicAffinity?: string;
}) {
  if (!params.personalized) return { code: 'latest_public_reel' };
  const topics = params.reel.reelTopicIds || [];
  if (params.followedCreators.has(params.reel.authorUserId.toString())) {
    return { code: 'followed_creator', creatorHandle: params.author?.profileHandle || undefined };
  }
  const followedTopic = topics.find((topicId) => params.followedTopics.has(topicId));
  if (followedTopic) return { code: 'followed_topic', topicId: followedTopic, topicLabel: topicLabels([followedTopic])[0]?.label };
  if (params.creatorAffinity > 0) return { code: 'creator_affinity', creatorHandle: params.author?.profileHandle || undefined };
  if (params.topTopicAffinity) return { code: 'topic_affinity', topicId: params.topTopicAffinity, topicLabel: topicLabels([params.topTopicAffinity])[0]?.label };
  if (topics.length) return { code: 'fresh_topic_reel', topicId: topics[0], topicLabel: topicLabels([topics[0]])[0]?.label };
  return { code: 'new_public_reel' };
}

function diversifyReels(ranked: Array<{ reel: ReelDocument; score: number; explanation: Omit<ReelForYouExplanationSnapshot, 'reelId'> }>) {
  const selected: typeof ranked = [];
  const remaining = [...ranked];
  while (remaining.length && selected.length < REEL_FOR_YOU_MAX_CANDIDATES) {
    const countsByCreator = new Map<string, number>();
    const countsByTopic = new Map<string, number>();
    for (const item of selected.slice(0, REEL_FOR_YOU_PAGE_LIMIT)) {
      countsByCreator.set(item.reel.authorUserId.toString(), (countsByCreator.get(item.reel.authorUserId.toString()) || 0) + 1);
      for (const topicId of item.reel.reelTopicIds || []) countsByTopic.set(topicId, (countsByTopic.get(topicId) || 0) + 1);
    }
    const previousCreator = selected[selected.length - 1]?.reel.authorUserId.toString();
    let index = remaining.findIndex((item) => {
      const creatorId = item.reel.authorUserId.toString();
      if (creatorId === previousCreator && remaining.length > 1) return false;
      if (selected.length < REEL_FOR_YOU_PAGE_LIMIT && (countsByCreator.get(creatorId) || 0) >= 2 && remaining.length > 3) return false;
      if (selected.length < REEL_FOR_YOU_PAGE_LIMIT && (item.reel.reelTopicIds || []).some((topicId) => (countsByTopic.get(topicId) || 0) >= 4) && remaining.length > 5) return false;
      return true;
    });
    if (index === -1) index = 0;
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected;
}

async function bumpReelAffinity(userId: ObjectId, affinityType: 'creator' | 'topic', affinityKey: ObjectId | string, amount: number) {
  if (amount <= 0) return;
  const now = new Date();
  const identity = { userId, surface: 'reels', affinityType, affinityKey };
  const existing = await getDatabase().collection('discovery_affinities').findOne(identity);
  const score = clampReelAffinityScore((existing?.score || 0) + amount);
  await getDatabase().collection('discovery_affinities').updateOne(
    identity,
    {
      $setOnInsert: { _id: new ObjectId(), userId, surface: 'reels', affinityType, affinityKey, createdAt: now, schemaVersion: 1 },
      $set: { score, lastSignalAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + REEL_FOR_YOU_AFFINITY_TTL_MS) },
    },
    { upsert: true }
  );
}

async function applyReelAffinityFromSignal(userId: ObjectId, reel: ReelDocument, eventType: string, bucket?: string | null) {
  if (reel.authorUserId.equals(userId) || !(await isBrowseEligibleForViewer(reel, userId))) return;
  let weights = REEL_AFFINITY_SIGNAL_WEIGHTS[eventType] || { creator: 0, topic: 0 };
  if (eventType === 'reel_watch_bucket' && bucket) weights = REEL_WATCH_AFFINITY_WEIGHTS[bucket] || weights;
  if (eventType === 'reel_completion_bucket' && bucket) weights = REEL_COMPLETION_AFFINITY_WEIGHTS[bucket] || weights;
  await bumpReelAffinity(userId, 'creator', reel.authorUserId, weights.creator);
  for (const topicId of (reel.reelTopicIds || []).filter((id) => TOPICS.has(id))) {
    await bumpReelAffinity(userId, 'topic', topicId, weights.topic);
  }
}

async function recordReelPersonalizationSignal(params: {
  userId: ObjectId;
  reel: ReelDocument;
  eventType: string;
  sourceContext: 'reels_browse' | 'reels_for_you';
  bucket?: string | null;
}) {
  const pref = await getDatabase().collection('discovery_preferences').findOne({ userId: params.userId });
  if (pref?.personalizedDiscoveryEnabled === false) return { recorded: false };
  if (params.reel.authorUserId.equals(params.userId) || !(await isBrowseEligibleForViewer(params.reel, params.userId))) return { recorded: false };
  const now = new Date();
  const dedupeKey = [
    params.userId.toString(),
    'reel',
    params.reel._id.toString(),
    params.eventType,
    params.sourceContext,
    params.bucket || 'none',
    Math.floor(now.getTime() / (60 * 60 * 1000)),
  ].join(':');
  const result = await getDatabase().collection('discovery_events').updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        userId: params.userId,
        targetType: 'reel',
        targetId: params.reel._id,
        eventType: params.eventType,
        sourceContext: params.sourceContext,
        topicIds: params.reel.reelTopicIds || [],
        dwellBucket: params.bucket || undefined,
        dedupeKey,
        createdAt: now,
        expiresAt: new Date(now.getTime() + EVENT_RETENTION_MS),
        schemaVersion: 1,
      },
    },
    { upsert: true }
  );
  if (result.upsertedCount) await applyReelAffinityFromSignal(params.userId, params.reel, params.eventType, params.bucket);
  return { recorded: Boolean(result.upsertedCount) };
}

async function buildReelForYouSession(viewerUserId: ObjectId, personalized: boolean) {
  const now = new Date();
  const pref = await getDatabase().collection('discovery_preferences').findOne({ userId: viewerUserId });
  const mutedTopics = new Set<string>(pref?.mutedTopicIds || []);
  const [followedCreators, communityTopics, affinityMaps, signals] = await Promise.all([
    followedCreatorIds(viewerUserId),
    joinedOpenCommunityTopicIds(viewerUserId),
    loadReelAffinityMaps(viewerUserId, personalized),
    recentReelSignals(viewerUserId),
  ]);
  const followedTopics = new Set<string>(personalized ? pref?.followedTopicIds || [] : []);
  const candidates = await getReelsCollection()
    .find({
      reelDiscoverable: true,
      publishState: 'published',
      processingStatus: 'ready',
      visibility: 'public',
      deletedAt: { $exists: false },
      moderationRemovedAt: { $exists: false },
      authorUserId: { $ne: viewerUserId },
      publishedAt: { $gte: new Date(now.getTime() - REEL_FOR_YOU_CANDIDATE_WINDOW_MS) },
    })
    .sort({ publishedAt: -1, _id: -1 })
    .limit(REEL_FOR_YOU_MAX_CANDIDATES)
    .toArray() as ReelDocument[];
  const ranked: Array<{ reel: ReelDocument; score: number; explanation: Omit<ReelForYouExplanationSnapshot, 'reelId'> }> = [];
  for (const reel of candidates) {
    if (reel.authorUserId.equals(viewerUserId)) continue;
    if (!(await isBrowseEligibleForViewer(reel, viewerUserId))) continue;
    const topicIds = (reel.reelTopicIds || []).filter((topicId) => TOPICS.has(topicId) && !mutedTopics.has(topicId));
    const author = await getDatabase().collection('users').findOne(activeUserQuery({ _id: reel.authorUserId }) as any, { projection: { profileHandle: 1 } });
    let score = personalized ? reelFreshnessScore(reel.publishedAt || reel.createdAt, now) : 0;
    const authorId = reel.authorUserId.toString();
    let topTopicAffinity: string | undefined;
    if (personalized) {
      if (followedCreators.has(authorId)) score += REEL_FOR_YOU_WEIGHTS.followedCreator;
      score += Math.min(REEL_FOR_YOU_WEIGHTS.followedTopicMax, topicIds.filter((topicId) => followedTopics.has(topicId)).length * REEL_FOR_YOU_WEIGHTS.followedTopic);
      const creatorAffinity = affinityMaps.creators.get(authorId) || 0;
      score += Math.min(REEL_FOR_YOU_WEIGHTS.creatorAffinityMax, Math.round(creatorAffinity * 0.3));
      const topicAffinityScores = topicIds.map((topicId) => ({ topicId, score: affinityMaps.topics.get(topicId) || 0 })).sort((a, b) => b.score - a.score);
      topTopicAffinity = topicAffinityScores.find((item) => item.score > 0)?.topicId;
      score += Math.min(REEL_FOR_YOU_WEIGHTS.topicAffinityMax, topicAffinityScores.reduce((total, item) => total + Math.round(item.score * 0.18), 0));
      score += Math.min(REEL_FOR_YOU_WEIGHTS.recentPositiveMax, signals.reelWeights.get(reel._id.toString()) || 0);
      if (!signals.recentOpened.has(reel._id.toString())) score += REEL_FOR_YOU_WEIGHTS.newCreator;
      if (signals.recentOpened.has(reel._id.toString())) score += REEL_FOR_YOU_WEIGHTS.recentSeenPenalty;
      if (signals.quickSkipped.has(reel._id.toString())) score += REEL_FOR_YOU_WEIGHTS.quickSkipPenalty;
      score += Math.min(REEL_FOR_YOU_WEIGHTS.communityTopicMax, topicIds.filter((topicId) => communityTopics.has(topicId)).length * 6);
      ranked.push({
        reel,
        score,
        explanation: primaryReelExplanation({ personalized, reel, author, followedCreators, followedTopics, creatorAffinity, topTopicAffinity }),
      });
    } else {
      ranked.push({ reel, score, explanation: primaryReelExplanation({ personalized, reel, author, followedCreators, followedTopics, creatorAffinity: 0 }) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || (b.reel.publishedAt || b.reel.createdAt).getTime() - (a.reel.publishedAt || a.reel.createdAt).getTime() || b.reel._id.toString().localeCompare(a.reel._id.toString()));
  const ordered = personalized ? diversifyReels(ranked) : ranked.slice(0, REEL_FOR_YOU_MAX_CANDIDATES);
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const refreshGeneration = await getReelForYouSessionsCollection().countDocuments({ userId: viewerUserId });
  await getReelForYouSessionsCollection().insertOne({
    _id: new ObjectId(),
    sessionHash: hashToken(sessionToken),
    userId: viewerUserId,
    rankingModelVersion: REEL_FOR_YOU_RANKING_MODEL_VERSION,
    orderedReelIds: ordered.map((item) => item.reel._id),
    explanations: ordered.map((item) => ({ reelId: item.reel._id, ...item.explanation })),
    createdAt: now,
    expiresAt: new Date(now.getTime() + REEL_FOR_YOU_SESSION_TTL_MS),
    refreshGeneration,
    schemaVersion: 1,
  });
  return { sessionToken, sessionHash: hashToken(sessionToken), offset: 0 };
}

async function loadReelForYouSession(viewerUserId: ObjectId, cursor: unknown, personalized: boolean) {
  const decoded = decodeForYouCursor(cursor);
  if (!decoded) return buildReelForYouSession(viewerUserId, personalized);
  const session = await getReelForYouSessionsCollection().findOne({
    sessionHash: hashToken(decoded.sessionToken),
    userId: viewerUserId,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    const error: any = new Error('Session unavailable.');
    error.statusCode = 404;
    throw error;
  }
  return { sessionToken: decoded.sessionToken, sessionHash: session.sessionHash, offset: decoded.offset };
}

async function serializeReel(reel: ReelDocument, ownerView = false, viewerUserId?: ObjectId, includeEventToken: false | 'reels_browse' | 'reels_for_you' = false) {
  const state = viewerUserId ? await currentInteractionState(reel, viewerUserId) : { myReaction: null, saved: false };
  const author = await getDatabase().collection('users').findOne(activeUserQuery({ _id: reel.authorUserId }) as any, { projection: { name: 1, profileHandle: 1, avatarUrl: 1 } });
  const payload: any = {
    id: reel._id.toString(),
    caption: reel.caption,
    visibility: reel.visibility,
    topics: reel.topicIds || [],
    reelDiscoverable: ownerView ? Boolean(reel.reelDiscoverable) : undefined,
    reelTopics: topicLabels(reel.reelTopicIds || []),
    author: author ? {
      name: author.name,
      handle: author.profileHandle || null,
      displayHandle: author.profileHandle ? `@${author.profileHandle}` : null,
      avatarUrl: author.avatarUrl || null,
    } : null,
    reactionCounts: reel.reactionCounts || {},
    myReaction: state.myReaction,
    commentCount: reel.commentCount || 0,
    saved: state.saved,
    sourceAttribution: pexelsAttribution(reel),
    processingStatus: ownerView ? reel.processingStatus : reel.processingStatus === 'ready' ? 'ready' : undefined,
    publishState: reel.publishState,
    durationSeconds: reel.durationSeconds || null,
    width: reel.width || null,
    height: reel.height || null,
    publishedAt: reel.publishedAt || null,
    createdAt: reel.createdAt,
    updatedAt: reel.updatedAt,
  };
  if (includeEventToken && viewerUserId) payload.eventToken = await issueReelEventToken(viewerUserId, reel._id, includeEventToken);
  return payload;
}

async function issueReelEventToken(viewerUserId: ObjectId, reelId: ObjectId, sourceContext: 'reels_browse' | 'reels_for_you' = 'reels_browse') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await getDatabase().collection('discovery_candidate_tokens').insertOne({
    _id: new ObjectId(),
    tokenHash: hashToken(token),
    viewerUserId,
    targetType: 'reel',
    targetId: reelId,
    sourceContext,
    createdAt: now,
    expiresAt: new Date(now.getTime() + EVENT_TOKEN_TTL_MS),
    consumedEventKeys: [],
  });
  return token;
}

async function recomputeReelAggregates(reelId: ObjectId) {
  const [reactionRows, commentCount] = await Promise.all([
    getReelReactionsCollection().aggregate<{ _id: string; count: number }>([
      { $match: { reelId } },
      { $group: { _id: '$emoji', count: { $sum: 1 } } },
    ]).toArray(),
    getReelCommentsCollection().countDocuments({ reelId, deletedAt: { $exists: false } }),
  ]);
  const reactionCounts = Object.fromEntries(reactionRows.map((item) => [item._id, item.count]));
  await getReelsCollection().updateOne({ _id: reelId }, { $set: { reactionCounts, commentCount, updatedAt: new Date() } });
  return { reactionCounts, commentCount };
}

function normalizeCommentBody(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

async function serializeComment(comment: any) {
  const author = await getDatabase().collection('users').findOne(activeUserQuery({ _id: comment.authorUserId }) as any, { projection: { name: 1, profileHandle: 1, avatarUrl: 1 } });
  if (!author) return null;
  return {
    id: comment._id.toString(),
    author: {
      name: author.name,
      handle: author.profileHandle || null,
      displayHandle: author.profileHandle ? `@${author.profileHandle}` : null,
      avatarUrl: author.avatarUrl || null,
    },
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

async function maybeSendReelInteractionNotification(reel: ReelDocument, actorUserId: ObjectId, kind: 'reaction' | 'comment') {
  if (reel.authorUserId.equals(actorUserId)) return;
  const now = new Date();
  const cooldown = await getReelNotificationCooldownsCollection().findOne({
    reelId: reel._id,
    actorUserId,
    recipientUserId: reel.authorUserId,
    kind,
    expiresAt: { $gt: now },
  });
  if (cooldown) return;
  const [actor, pref] = await Promise.all([
    getDatabase().collection('users').findOne(activeUserQuery({ _id: actorUserId }) as any, { projection: { name: 1 } }),
    getDatabase().collection('notificationPreferences').findOne({ userId: reel.authorUserId }),
  ]);
  const reelActivityEnabled = pref?.reelActivityEnabled !== false;
  const previewsEnabled = Boolean(pref?.notificationPreviewsEnabled);
  if (!actor || !reelActivityEnabled) return;
  await getReelNotificationCooldownsCollection().insertOne({
    _id: new ObjectId(),
    reelId: reel._id,
    actorUserId,
    recipientUserId: reel.authorUserId,
    kind,
    createdAt: now,
    expiresAt: new Date(now.getTime() + NOTIFICATION_COOLDOWN_MS),
  });
  const body = previewsEnabled
    ? `${actor.name || 'Someone'} ${kind === 'reaction' ? 'reacted to' : 'commented on'} your Reel.`
    : 'You have a new Reel interaction.';
  await axios.post(`${NOTIFICATIONS_SERVICE_URL}/send`, {
    userId: reel.authorUserId.toString(),
    kind: 'reel_activity',
    title: 'Blabber',
    body,
    data: {
      route: `/reels/${reel._id.toString()}`,
      noPreviewBody: 'You have a new Reel interaction.',
    },
  }).catch(() => undefined);
}

function isMp4Upload(fileName: string, fileType: string) {
  const type = fileType.split(';')[0].trim().toLowerCase();
  return safeExtension(fileName) === '.mp4' && type === 'video/mp4';
}

function isSafeMediaPath(path: string) {
  return path === MEDIA_ROOT || path.startsWith(`${MEDIA_ROOT}/`);
}

async function streamFile(res: Response, path: string, contentType: string, range?: string) {
  if (!isSafeMediaPath(path)) {
    unavailable(res);
    return;
  }
  try {
    const stat = await fs.stat(path);
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : stat.size - 1;
        if (start <= end && end < stat.size) {
          res.status(206);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          createReadStream(path, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.setHeader('Content-Length', stat.size);
    createReadStream(path).pipe(res);
  } catch {
    unavailable(res);
  }
}

export const initiateReelUpload = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  if (!user.emailVerified || !user.profileHandle) {
    validationError(res, 'Verify your email and claim a handle before creating a Reel.');
    return;
  }
  const parsedUpload = uploadInitSchema.safeParse(req.body);
  if (!parsedUpload.success) {
    validationError(res);
    return;
  }
  const parsed = parsedUpload.data;
  if (!isMp4Upload(sanitizeDisplayFileName(parsed.fileName), parsed.fileType)) {
    validationError(res);
    return;
  }
  const now = new Date();
  const reelId = new ObjectId();
  const mediaId = new ObjectId();
  const localPath = join(MEDIA_ROOT, 'reel-sources', `${mediaId.toString()}.mp4`);
  await getMediaCollection().insertOne({
    _id: mediaId,
    userId,
    fileName: sanitizeDisplayFileName(parsed.fileName),
    originalFileName: parsed.fileName,
    fileType: 'video/mp4',
    fileSize: parsed.fileSize,
    s3Key: `reel-source/${userId.toString()}/${mediaId.toString()}.mp4`,
    url: '',
    storage: 'local',
    localPath,
    status: 'pending',
    purpose: 'reel_source',
    reelId,
    createdAt: now,
  });
  await getReelsCollection().insertOne({
    _id: reelId,
    authorUserId: userId,
    sourceMediaId: mediaId,
    processingStatus: 'upload_initiated',
    publishState: 'draft',
    caption: '',
    visibility: 'followers',
    topicIds: [],
    processingKey: `${reelId.toString()}:${mediaId.toString()}`,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  });
  res.status(201).json({
    reelId: reelId.toString(),
    uploadUrl: `/api/reels/uploads/${reelId.toString()}/source`,
    uploadMethod: 'PUT',
    status: 'upload_initiated',
  });
});

export const uploadReelSource = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId), authorUserId: userId, deletedAt: { $exists: false } });
  if (!reel || reel.processingStatus !== 'upload_initiated') {
    unavailable(res);
    return;
  }
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length <= 0 || body.length > REEL_MAX_SOURCE_BYTES) {
    validationError(res);
    return;
  }
  const media = await getMediaCollection().findOne({ _id: reel.sourceMediaId, userId, status: 'pending', purpose: 'reel_source' });
  if (!media?.localPath) {
    unavailable(res);
    return;
  }
  await getMediaCollection().updateOne({ _id: media._id }, { $set: { status: 'scanning', updatedAt: new Date() } } as any);
  const scan = await scanBuffer(body);
  if (!scan.ok) {
    await getMediaCollection().updateOne({ _id: media._id }, { $set: { status: scan.category === 'infected' ? 'quarantined' : 'rejected', scanResult: scan.category === 'infected' ? 'infected' : 'error', scanMode: scan.mode, scanErrorCategory: scan.category, rejectedAt: new Date() } });
    await getReelsCollection().updateOne({ _id: reel._id }, { $set: { processingStatus: 'rejected', validationFailureCategory: 'scanner_rejected', updatedAt: new Date() } });
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
  await getReelsCollection().updateOne({ _id: reel._id, processingStatus: 'upload_initiated' }, { $set: { processingStatus: 'uploaded', updatedAt: now } });
  res.status(200).json({ reelId: reel._id.toString(), status: 'uploaded' });
});

export const getReelStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId), authorUserId: userId });
  if (!reel || reel.deletedAt) {
    unavailable(res);
    return;
  }
  res.status(200).json({ reel: await serializeReel(reel, true, userId), message: ['rejected', 'failed'].includes(reel.processingStatus) ? REEL_ERROR_MESSAGE : null });
});

export const publishReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  if (!user.emailVerified || !user.profileHandle) {
    validationError(res, 'Verify your email and claim a handle before creating a Reel.');
    return;
  }
  const parsedPublish = publishSchema.safeParse(req.body);
  if (!parsedPublish.success) {
    validationError(res);
    return;
  }
  const parsed = parsedPublish.data;
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(parsed.reelId), authorUserId: userId, deletedAt: { $exists: false } });
  if (!reel) {
    unavailable(res);
    return;
  }
  if (reel.processingStatus !== 'ready') {
    res.status(409).json({ error: 'Conflict', message: 'This Reel is still processing.' });
    return;
  }
  if ((user.profileVisibility || 'private') !== 'public' && parsed.visibility === 'public') {
    validationError(res, 'Private profiles can publish Followers Reels only.');
    return;
  }
  let topicIds: string[];
  try {
    topicIds = normalizeTopics(parsed.topicIds || []);
  } catch {
    validationError(res, 'Invalid Reel topics.');
    return;
  }
  const now = new Date();
  const updated = await getReelsCollection().findOneAndUpdate(
    { _id: reel._id },
    { $set: { caption: normalizeCaption(parsed.caption), visibility: parsed.visibility, topicIds, publishState: 'published', publishedAt: reel.publishedAt || now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  res.status(201).json({ reel: await serializeReel(updated!, true, userId) });
});

export const getReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, userId, true))) {
    unavailable(res);
    return;
  }
  res.status(200).json({ reel: await serializeReel(reel, reel.authorUserId.equals(userId), userId) });
});

export const updateReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const parsedEdit = editSchema.safeParse(req.body);
  if (!parsedEdit.success) {
    validationError(res);
    return;
  }
  const parsed = parsedEdit.data;
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId), authorUserId: userId, publishState: 'published', deletedAt: { $exists: false } });
  if (!reel) {
    unavailable(res);
    return;
  }
  if (!reel.publishedAt || Date.now() - reel.publishedAt.getTime() > REEL_EDIT_WINDOW_MS) {
    res.status(409).json({ error: 'Conflict', message: 'This Reel can no longer be edited.' });
    return;
  }
  const updated = await getReelsCollection().findOneAndUpdate(
    { _id: reel._id },
    { $set: { caption: normalizeCaption(parsed.caption), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  res.status(200).json({ reel: await serializeReel(updated!, true, userId) });
});

export const deleteReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId), authorUserId: userId, deletedAt: { $exists: false } });
  if (!reel) {
    unavailable(res);
    return;
  }
  const now = new Date();
  await getReelsCollection().updateOne({ _id: reel._id }, { $set: { processingStatus: 'deleted', publishState: 'deleted', deletedAt: now, updatedAt: now } });
  await getReelPlaybackSessionsCollection().updateMany({ reelId: reel._id }, { $set: { revokedAt: now } });
  await Promise.all([
    getReelReactionsCollection().deleteMany({ reelId: reel._id }),
    getReelCommentsCollection().deleteMany({ reelId: reel._id }),
    getReelSavesCollection().deleteMany({ reelId: reel._id }),
    getReelNotificationCooldownsCollection().deleteMany({ reelId: reel._id }),
    getReelForYouSessionsCollection().deleteMany({ orderedReelIds: reel._id }),
    getDatabase().collection('discovery_feedback').deleteMany({ targetType: 'reel', targetId: reel._id }),
    getDatabase().collection('discovery_events').deleteMany({ targetType: 'reel', targetId: reel._id }),
    getDatabase().collection('discovery_candidate_tokens').deleteMany({ targetType: 'reel', targetId: reel._id }),
  ]);
  await deleteReelFiles(reel);
  await getMediaCollection().updateMany({ $or: [{ _id: reel.sourceMediaId }, { reelId: reel._id }] }, { $set: { status: 'deleted', deletedAt: now }, $unset: { url: '', publicUrl: '' } } as any);
  res.status(200).json({ success: true });
});

export const listProfileReels = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const handle = String(req.params.handle || '').replace(/^@/, '').toLowerCase();
  const author = await getDatabase().collection('users').findOne(activeUserQuery({ profileHandle: handle }) as any);
  if (!author || await hasBlockBetween(viewerUserId, author._id)) {
    unavailable(res);
    return;
  }
  const owner = author._id.equals(viewerUserId);
  const following = owner ? true : await isFollowing(viewerUserId, author._id);
  if (!owner && (author.profileVisibility || 'private') === 'private' && !following) {
    res.status(200).json({ reels: [], nextCursor: null, locked: true });
    return;
  }
  const cursorDate = typeof req.query.cursor === 'string' ? new Date(req.query.cursor) : null;
  const visibilityFilter = owner
    ? {}
    : { publishState: 'published', processingStatus: 'ready', visibility: following ? { $in: ['public', 'followers'] } : 'public' };
  const reels = await getReelsCollection()
    .find({
      authorUserId: author._id,
      deletedAt: { $exists: false },
      ...(cursorDate && !Number.isNaN(cursorDate.getTime()) ? { createdAt: { $lt: cursorDate } } : {}),
      ...visibilityFilter,
    } as any)
    .sort({ createdAt: -1 })
    .limit(PAGE_LIMIT + 1)
    .toArray();
  const page = reels.slice(0, PAGE_LIMIT);
  res.status(200).json({
    reels: await Promise.all(page.map((reel) => serializeReel(reel, owner, viewerUserId))),
    nextCursor: reels.length > PAGE_LIMIT ? page[page.length - 1]?.createdAt.toISOString() : null,
    locked: false,
  });
});

export const listReelsBrowse = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const topic = typeof req.query.topic === 'string' ? req.query.topic : undefined;
  const q = searchTerm(req.query.q);
  if (topic && !TOPICS.has(topic)) validationError(res, 'Invalid Reel topic.');
  if (res.headersSent) return;
  const cursor = decodeCursor(req.query.cursor);
  const regex = q ? new RegExp(escapeRegex(q), 'i') : null;
  const query: any = {
    reelDiscoverable: true,
    publishState: 'published',
    processingStatus: 'ready',
    visibility: 'public',
    deletedAt: { $exists: false },
    moderationRemovedAt: { $exists: false },
    ...(topic ? { reelTopicIds: topic } : {}),
    ...(regex ? { $or: [{ caption: regex }, { reelTopicIds: regex }, { 'importer.providerCreatorName': regex }] } : {}),
    ...cursorFilter(cursor, 'publishedAt'),
  };
  const candidates = await getReelsCollection()
    .find(query)
    .sort({ publishedAt: -1, _id: -1 })
    .limit(PAGE_LIMIT * 3 + 1)
    .toArray();
  const reels = [];
  for (const reel of candidates) {
    if (await isBrowseEligibleForViewer(reel, viewerUserId)) {
      reels.push(await serializeReel(reel, false, viewerUserId, 'reels_browse'));
    }
    if (reels.length >= PAGE_LIMIT) break;
  }
  const last = candidates[Math.min(candidates.length, PAGE_LIMIT) - 1];
  res.status(200).json({
    reels,
    nextCursor: candidates.length > PAGE_LIMIT && last && last.publishedAt ? encodeCursor(last.publishedAt, last._id) : null,
  });
});

export const listReelsForYou = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const pref = await getDatabase().collection('discovery_preferences').findOne({ userId: viewerUserId });
  const personalized = pref?.personalizedDiscoveryEnabled !== false;
  const sessionRef = await loadReelForYouSession(viewerUserId, req.query.cursor, personalized);
  const session = await getReelForYouSessionsCollection().findOne({ sessionHash: sessionRef.sessionHash, userId: viewerUserId });
  if (!session) {
    unavailable(res);
    return;
  }
  const explanations = new Map(session.explanations.map((item) => [item.reelId.toString(), item]));
  const reels = [];
  let nextOffset = sessionRef.offset;
  for (let index = sessionRef.offset; index < session.orderedReelIds.length && reels.length < REEL_FOR_YOU_PAGE_LIMIT; index += 1) {
    nextOffset = index + 1;
    const reel = await getReelsCollection().findOne({ _id: session.orderedReelIds[index], deletedAt: { $exists: false } });
    if (!reel || reel.authorUserId.equals(viewerUserId) || !(await isBrowseEligibleForViewer(reel, viewerUserId))) continue;
    const serialized = await serializeReel(reel, false, viewerUserId, personalized ? 'reels_for_you' : false);
    reels.push({ ...serialized, explanation: explanationResponse(explanations.get(reel._id.toString())) });
  }
  res.status(200).json({
    reels,
    nextCursor: nextOffset < session.orderedReelIds.length ? encodeForYouCursor(sessionRef.sessionToken, nextOffset) : null,
    personalized,
    message: personalized ? null : 'Personalized discovery is off. You are seeing the latest public Reels.',
  });
});

export const refreshReelsForYou = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const pref = await getDatabase().collection('discovery_preferences').findOne({ userId: viewerUserId });
  await getReelForYouSessionsCollection().deleteMany({ userId: viewerUserId, expiresAt: { $lte: new Date() } });
  const session = await buildReelForYouSession(viewerUserId, pref?.personalizedDiscoveryEnabled !== false);
  res.status(200).json({ cursor: encodeForYouCursor(session.sessionToken, 0) });
});

export const getReelsForYouExplanation = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reelId = new ObjectId(req.params.reelId);
  const reel = await getReelsCollection().findOne({ _id: reelId, deletedAt: { $exists: false } });
  if (!reel || reel.authorUserId.equals(viewerUserId) || !(await isBrowseEligibleForViewer(reel, viewerUserId))) {
    unavailable(res);
    return;
  }
  const session = await getReelForYouSessionsCollection().findOne(
    { userId: viewerUserId, orderedReelIds: reelId, expiresAt: { $gt: new Date() } },
    { sort: { createdAt: -1 } }
  );
  const explanation = session?.explanations.find((item) => item.reelId.equals(reelId));
  res.status(200).json({ explanation: explanationResponse(explanation) });
});

export const updateReelDiscovery = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const parsed = discoverySchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, 'Invalid Reel discovery settings.');
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId), authorUserId: userId, deletedAt: { $exists: false } });
  if (!reel) {
    unavailable(res);
    return;
  }
  let topicIds: string[] = [];
  try {
    topicIds = parsed.data.reelDiscoverable ? normalizeTopics(parsed.data.reelTopicIds) : normalizeTopics(parsed.data.reelTopicIds || []);
  } catch {
    validationError(res, 'Invalid Reel topics.');
    return;
  }
  if (parsed.data.reelDiscoverable) {
    if (topicIds.length < 1 || topicIds.length > 3) {
      validationError(res, 'Choose one to three Reel topics.');
      return;
    }
    if (reel.visibility !== 'public' || reel.publishState !== 'published' || reel.processingStatus !== 'ready') {
      validationError(res, 'This Reel is not eligible for Reels Browse.');
      return;
    }
    if (!user.emailVerified || !user.profileHandle || user.profileVisibility !== 'public' || !user.creatorDiscoveryEnabled) {
      validationError(res, 'Enable Creator discovery on a verified public profile first.');
      return;
    }
    if (!(await mediaApprovedForReel(reel))) {
      validationError(res, 'This Reel is not eligible for Reels Browse.');
      return;
    }
  }
  const now = new Date();
  const updated = await getReelsCollection().findOneAndUpdate(
    { _id: reel._id },
    {
      $set: {
        reelDiscoverable: parsed.data.reelDiscoverable,
        reelTopicIds: topicIds,
        reelDiscoverableUpdatedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' }
  );
  res.status(200).json({ reel: await serializeReel(updated!, true, userId) });
});

export const createReelEventToken = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await isBrowseEligibleForViewer(reel, userId))) {
    unavailable(res);
    return;
  }
  res.status(201).json({ eventToken: await issueReelEventToken(userId, reel._id), expiresInSeconds: Math.floor(EVENT_TOKEN_TTL_MS / 1000) });
});

export const recordReelEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const parsedEvent = watchEventSchema.safeParse(req.body);
  if (!parsedEvent.success) {
    validationError(res, 'Invalid Reel event.');
    return;
  }
  const parsed = parsedEvent.data;
  if (parsed.eventType === 'reel_watch_bucket' && !parsed.watchBucket) {
    validationError(res, 'Invalid watch bucket.');
    return;
  }
  if (parsed.eventType === 'reel_completion_bucket' && !parsed.completionBucket) {
    validationError(res, 'Invalid completion bucket.');
    return;
  }
  if (parsed.eventType === 'reel_quick_skip' && parsed.skipReason !== 'user_next_reel') {
    validationError(res, 'Invalid skip event.');
    return;
  }
  if (parsed.eventType !== 'reel_watch_bucket' && parsed.watchBucket) validationError(res, 'Invalid Reel event.');
  if (res.headersSent) return;
  if (parsed.eventType !== 'reel_completion_bucket' && parsed.completionBucket) validationError(res, 'Invalid Reel event.');
  if (res.headersSent) return;
  const token = await getDatabase().collection('discovery_candidate_tokens').findOne({
    tokenHash: hashToken(parsed.eventToken),
    viewerUserId: userId,
    targetType: 'reel',
    targetId: new ObjectId(req.params.reelId),
    sourceContext: { $in: ['reels_browse', 'reels_for_you'] },
    expiresAt: { $gt: new Date() },
  });
  if (!token) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: token.targetId });
  if (!reel || !(await isBrowseEligibleForViewer(reel, userId))) {
    unavailable(res);
    return;
  }
  const pref = await getDatabase().collection('discovery_preferences').findOne({ userId });
  if (pref?.personalizedDiscoveryEnabled === false) {
    res.status(200).json({ recorded: false });
    return;
  }
  const bucket = parsed.watchBucket || parsed.completionBucket || null;
  const eventKey = `${parsed.eventType}:${bucket || parsed.skipReason || 'none'}`;
  if ((token.consumedEventKeys || []).includes(eventKey)) {
    res.status(200).json({ recorded: false });
    return;
  }
  await getDatabase().collection('discovery_candidate_tokens').updateOne({ _id: token._id }, { $addToSet: { consumedEventKeys: eventKey } });
  const result = await recordReelPersonalizationSignal({
    userId,
    reel,
    eventType: parsed.eventType,
    sourceContext: token.sourceContext === 'reels_for_you' ? 'reels_for_you' : 'reels_browse',
    bucket: bucket || parsed.skipReason || null,
  });
  res.status(200).json(result);
});

export const setReelReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsed = reactionSchema.safeParse(req.body);
  if (!parsed.success || !ObjectId.isValid(req.params.reelId)) {
    validationError(res, 'Invalid Reel reaction.');
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || reel.processingStatus !== 'ready' || reel.publishState !== 'published' || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  const now = new Date();
  await getReelReactionsCollection().updateOne(
    { reelId: reel._id, reactingUserId: userId },
    {
      $setOnInsert: { _id: new ObjectId(), reelId: reel._id, reactingUserId: userId, authorUserId: reel.authorUserId, createdAt: now },
      $set: { emoji: parsed.data.emoji as ReelReactionEmoji, updatedAt: now },
    },
    { upsert: true }
  );
  const aggregates = await recomputeReelAggregates(reel._id);
  void recordReelPersonalizationSignal({ userId, reel, eventType: 'react_to_discoverable_reel', sourceContext: 'reels_browse' });
  void maybeSendReelInteractionNotification(reel, userId, 'reaction');
  res.status(200).json({ myReaction: parsed.data.emoji, reactionCounts: aggregates.reactionCounts });
});

export const removeReelReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  await getReelReactionsCollection().deleteOne({ reelId: reel._id, reactingUserId: userId });
  const aggregates = await recomputeReelAggregates(reel._id);
  res.status(200).json({ myReaction: null, reactionCounts: aggregates.reactionCounts });
});

export const listReelComments = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  const cursor = decodeCursor(req.query.cursor);
  const comments = await getReelCommentsCollection().find({
    reelId: reel._id,
    deletedAt: { $exists: false },
    ...cursorFilter(cursor, 'createdAt'),
  } as any).sort({ createdAt: -1, _id: -1 }).limit(PAGE_LIMIT + 1).toArray();
  const visible = [];
  for (const comment of comments.slice(0, PAGE_LIMIT)) {
    if (await hasBlockBetween(userId, comment.authorUserId)) continue;
    const serialized = await serializeComment(comment);
    if (serialized) visible.push(serialized);
  }
  const last = comments[Math.min(comments.length, PAGE_LIMIT) - 1];
  res.status(200).json({ comments: visible, nextCursor: comments.length > PAGE_LIMIT && last ? encodeCursor(last.createdAt, last._id) : null });
});

export const createReelComment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success || !ObjectId.isValid(req.params.reelId)) {
    validationError(res, 'Invalid Reel comment.');
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || reel.processingStatus !== 'ready' || reel.publishState !== 'published' || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  const body = normalizeCommentBody(parsed.data.body);
  if (!body) {
    validationError(res, 'Invalid Reel comment.');
    return;
  }
  const now = new Date();
  const comment = {
    _id: new ObjectId(),
    reelId: reel._id,
    reelAuthorUserId: reel.authorUserId,
    authorUserId: userId,
    body,
    createdAt: now,
  };
  await getReelCommentsCollection().insertOne(comment);
  const aggregates = await recomputeReelAggregates(reel._id);
  void recordReelPersonalizationSignal({ userId, reel, eventType: 'comment_on_discoverable_reel', sourceContext: 'reels_browse' });
  void maybeSendReelInteractionNotification(reel, userId, 'comment');
  res.status(201).json({ comment: await serializeComment(comment), commentCount: aggregates.commentCount });
});

export const deleteReelComment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId) || !ObjectId.isValid(req.params.commentId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  const comment = await getReelCommentsCollection().findOne({ _id: new ObjectId(req.params.commentId), reelId: reel._id, deletedAt: { $exists: false } });
  if (!comment) {
    unavailable(res);
    return;
  }
  if (!comment.authorUserId.equals(userId) && !reel.authorUserId.equals(userId)) {
    res.status(403).json({ error: 'Forbidden', message: 'You cannot remove this comment.' });
    return;
  }
  await getReelCommentsCollection().updateOne({ _id: comment._id }, { $set: { deletedAt: new Date(), deletedByUserId: userId } });
  const aggregates = await recomputeReelAggregates(reel._id);
  res.status(200).json({ success: true, commentCount: aggregates.commentCount });
});

export const saveReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  await getReelSavesCollection().updateOne(
    { userId, reelId: reel._id },
    { $setOnInsert: { _id: new ObjectId(), userId, reelId: reel._id, createdAt: new Date() } },
    { upsert: true }
  );
  void recordReelPersonalizationSignal({ userId, reel, eventType: 'save_discoverable_reel', sourceContext: 'reels_browse' });
  res.status(200).json({ saved: true });
});

export const unsaveReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  await getReelSavesCollection().deleteOne({ userId, reelId: new ObjectId(req.params.reelId) });
  res.status(200).json({ saved: false });
});

export const listSavedReels = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const cursor = decodeCursor(req.query.cursor);
  const saves = await getReelSavesCollection().find({
    userId,
    ...cursorFilter(cursor, 'createdAt'),
  } as any).sort({ createdAt: -1, _id: -1 }).limit(PAGE_LIMIT + 1).toArray();
  const reels = [];
  for (const save of saves.slice(0, PAGE_LIMIT)) {
    const reel = await getReelsCollection().findOne({ _id: save.reelId });
    if (reel && await canAccessReel(reel, userId)) reels.push(await serializeReel(reel, reel.authorUserId.equals(userId), userId));
  }
  const last = saves[Math.min(saves.length, PAGE_LIMIT) - 1];
  res.status(200).json({ reels, nextCursor: saves.length > PAGE_LIMIT && last ? encodeCursor(last.createdAt, last._id) : null });
});

async function upsertDiscoveryFeedback(userId: ObjectId, targetType: string, targetId: ObjectId | string, feedbackType: string) {
  const now = new Date();
  await getDatabase().collection('discovery_feedback').updateOne(
    { userId, targetType, targetId, feedbackType },
    { $setOnInsert: { _id: new ObjectId(), userId, targetType, targetId, feedbackType, createdAt: now }, $set: { updatedAt: now } },
    { upsert: true }
  );
}

export const notInterestedReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await isBrowseEligibleForViewer(reel, userId))) {
    unavailable(res);
    return;
  }
  await recordReelPersonalizationSignal({ userId, reel, eventType: 'not_interested_reel', sourceContext: 'reels_browse' });
  await upsertDiscoveryFeedback(userId, 'reel', reel._id, 'not_interested');
  await getReelPlaybackSessionsCollection().updateMany({ viewerUserId: userId, reelId: reel._id }, { $set: { revokedAt: new Date() } });
  res.status(200).json({ success: true });
});

export const undoNotInterestedReel = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  await getDatabase().collection('discovery_feedback').deleteOne({ userId, targetType: 'reel', targetId: new ObjectId(req.params.reelId), feedbackType: 'not_interested' });
  res.status(200).json({ success: true });
});

export const muteReelCreator = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  if (await isBrowseEligibleForViewer(reel, userId)) {
    await recordReelPersonalizationSignal({ userId, reel, eventType: 'mute_reel_creator', sourceContext: 'reels_browse' });
  }
  await upsertDiscoveryFeedback(userId, 'creator', reel.authorUserId, 'muted');
  const creatorReels = await getReelsCollection()
    .find({ authorUserId: reel.authorUserId })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .limit(1000)
    .toArray();
  await getReelPlaybackSessionsCollection().updateMany(
    { viewerUserId: userId, reelId: { $in: creatorReels.map((item) => item._id) } },
    { $set: { revokedAt: new Date() } }
  );
  res.status(200).json({ success: true });
});

export const createPlaybackSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || reel.processingStatus !== 'ready' || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await getReelPlaybackSessionsCollection().insertOne({
    _id: new ObjectId(),
    tokenHash: hashToken(token),
    viewerUserId: userId,
    reelId: reel._id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + REEL_PLAYBACK_SESSION_TTL_MS),
    schemaVersion: 1,
  });
  res.status(201).json({
    playback: {
      manifestUrl: `/api/reels/playback/${token}/manifest`,
      fallbackUrl: `/api/reels/playback/${token}/fallback`,
      posterUrl: `/api/reels/playback/${token}/poster`,
      expiresAt: new Date(now.getTime() + REEL_PLAYBACK_SESSION_TTL_MS),
    },
  });
});

export const getReelPoster = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || reel.processingStatus !== 'ready' || !reel.posterPath || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return;
  }
  await streamFile(res, reel.posterPath, 'image/jpeg');
});


async function sessionReel(req: Request, res: Response) {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const session = await getReelPlaybackSessionsCollection().findOne({ tokenHash: hashToken(String(req.params.sessionToken || '')), revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
  if (!session || !session.viewerUserId.equals(userId)) {
    unavailable(res);
    return null;
  }
  const reel = await getReelsCollection().findOne({ _id: session.reelId });
  if (!reel || reel.processingStatus !== 'ready' || !(await canAccessReel(reel, userId))) {
    unavailable(res);
    return null;
  }
  return reel;
}

export const playbackManifest = asyncHandler(async (req: Request, res: Response) => {
  const reel = await sessionReel(req, res);
  if (!reel) return;
  const playlistToken = 'playlist';
  const token = encodeURIComponent(String(req.params.sessionToken));
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.status(200).send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=${reel.width || 0}x${reel.height || 0}\n/api/reels/playback/${token}/segment/${playlistToken}\n`);
});

export const playbackSegment = asyncHandler(async (req: Request, res: Response) => {
  const reel = await sessionReel(req, res);
  if (!reel) return;
  const segmentToken = String(req.params.segmentToken || '');
  if (segmentToken === 'playlist') {
    const token = encodeURIComponent(String(req.params.sessionToken));
    const segments = reel.hlsSegments || [];
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.status(200).send([
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MEDIA-SEQUENCE:0',
      ...segments.flatMap((segment) => [`#EXTINF:${segment.durationSeconds.toFixed(1)},`, `/api/reels/playback/${token}/segment/${segment.token}`]),
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'));
    return;
  }
  const segment = (reel.hlsSegments || []).find((item) => item.token === segmentToken);
  if (!segment) {
    unavailable(res);
    return;
  }
  await streamFile(res, segment.path, 'video/mp2t');
});

export const playbackFallback = asyncHandler(async (req: Request, res: Response) => {
  const reel = await sessionReel(req, res);
  if (!reel?.fallbackPath) return;
  await streamFile(res, reel.fallbackPath, 'video/mp4', req.headers.range);
});

export const playbackPoster = asyncHandler(async (req: Request, res: Response) => {
  const reel = await sessionReel(req, res);
  if (!reel?.posterPath) return;
  await streamFile(res, reel.posterPath, 'image/jpeg');
});

export const reportReel = asyncHandler(async (req: Request, res: Response) => {
  const reporterUserId = requireUserId(req);
  await requireActiveUser(reporterUserId);
  if (!ObjectId.isValid(req.params.reelId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, reporterUserId))) {
    unavailable(res);
    return;
  }
  const reason = String(req.body?.reason || '').trim();
  const details = String(req.body?.details || '').trim();
  if (reason.length < 3 || reason.length > 120 || details.length > 1000) {
    validationError(res, 'Invalid report.');
    return;
  }
  const now = new Date();
  const duplicateKey = `${reporterUserId.toString()}:reel:${reel._id.toString()}`;
  const existing = await getDatabase().collection('reports').findOne({ duplicateKey, createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } });
  if (existing) {
    res.status(200).json({ report: { id: existing._id.toString(), targetType: 'reel', status: existing.status, reason: existing.reason, createdAt: existing.createdAt, updatedAt: existing.updatedAt }, duplicate: true });
    return;
  }
  const report = {
    _id: new ObjectId(),
    reporterUserId,
    targetType: 'reel',
    targetReelId: reel._id,
    targetUserId: reel.authorUserId,
    reason,
    details: details || undefined,
    status: 'open',
    duplicateKey,
    evidence: {
      targetReelId: reel._id.toString(),
      authorUserId: reel.authorUserId.toString(),
      visibility: reel.visibility,
      hasVideoDerivative: Boolean(reel.fallbackPath && reel.hlsSegments?.length),
      availability: 'available',
      reportTime: now,
    },
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
  };
  await getDatabase().collection('reports').insertOne(report);
  res.status(201).json({ report: { id: report._id.toString(), targetType: 'reel', status: 'open', reason, createdAt: now, updatedAt: now } });
});

export const reportReelComment = asyncHandler(async (req: Request, res: Response) => {
  const reporterUserId = requireUserId(req);
  await requireActiveUser(reporterUserId);
  if (!ObjectId.isValid(req.params.reelId) || !ObjectId.isValid(req.params.commentId)) {
    unavailable(res);
    return;
  }
  const reel = await getReelsCollection().findOne({ _id: new ObjectId(req.params.reelId) });
  if (!reel || !(await canAccessReel(reel, reporterUserId))) {
    unavailable(res);
    return;
  }
  const comment = await getReelCommentsCollection().findOne({ _id: new ObjectId(req.params.commentId), reelId: reel._id, deletedAt: { $exists: false } });
  if (!comment || await hasBlockBetween(reporterUserId, comment.authorUserId)) {
    unavailable(res);
    return;
  }
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, 'Invalid report.');
    return;
  }
  const now = new Date();
  const duplicateKey = `${reporterUserId.toString()}:reel_comment:${comment._id.toString()}`;
  const existing = await getDatabase().collection('reports').findOne({ duplicateKey, createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } });
  if (existing) {
    res.status(200).json({ report: { id: existing._id.toString(), targetType: 'reel_comment', status: existing.status, reason: existing.reason, createdAt: existing.createdAt, updatedAt: existing.updatedAt }, duplicate: true });
    return;
  }
  const report = {
    _id: new ObjectId(),
    reporterUserId,
    targetType: 'reel_comment',
    targetReelId: reel._id,
    targetCommentId: comment._id,
    targetUserId: comment.authorUserId,
    reason: parsed.data.reason,
    details: parsed.data.details,
    status: 'open',
    duplicateKey,
    evidence: {
      targetCommentId: comment._id.toString(),
      targetReelId: reel._id.toString(),
      commentAuthorUserId: comment.authorUserId.toString(),
      textSnapshot: comment.body.slice(0, 240),
      availability: 'available',
      reportTime: now,
    },
    createdAt: now,
    updatedAt: now,
    retentionExpiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
  };
  await getDatabase().collection('reports').insertOne(report);
  res.status(201).json({ report: { id: report._id.toString(), targetType: 'reel_comment', status: 'open', reason: report.reason, createdAt: now, updatedAt: now } });
});
