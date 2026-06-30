import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType } from '@repo/types';
import { asyncHandler, createEvent, logger, ValidationError } from '@repo/utils';
import { getDatabase } from '../db';
import { getUsersCollection } from '../models/user';
import { hasBlockBetween } from '../models/user-block';
import { getCommunitiesCollection, CommunityDocument } from '../models/community';
import { getCommunityMembershipsCollection, CommunityMembershipDocument, CommunityRole } from '../models/community-membership';
import { getCommunityJoinRequestsCollection } from '../models/community-join-request';
import { getCommunityBansCollection } from '../models/community-ban';
import { getCommunityInvitesCollection } from '../models/community-invite';
import { getCommunityPostsCollection, CommunityPostDocument } from '../models/community-post';
import { getCommunityPostCommentsCollection, CommunityPostCommentDocument } from '../models/community-post-comment';
import { COMMUNITY_REACTION_EMOJIS, getCommunityPostReactionsCollection } from '../models/community-post-reaction';
import { getCommunityHandleReservationsCollection } from '../models/community-handle-reservation';
import { getCommunityModerationActivityCollection } from '../models/community-moderation-activity';
import { getPubSub } from '../pubsub';

const HANDLE_REGEX = /^[a-z][a-z0-9_]{2,29}$/;
const RESERVED_HANDLES = new Set([
  'admin', 'support', 'system', 'settings', 'profile', 'profiles', 'moments', 'chats', 'messages', 'search',
  'moderation', 'api', 'auth', 'login', 'signup', 'register', 'notifications', 'assets', 'static', 'feed',
  'communities', 'community', 'blabber', 'healthz', 'readyz', 'users', 'reports', 'media', 'invites',
]);
const POST_TEXT_LIMIT = 2000;
const COMMENT_TEXT_LIMIT = 1000;
const MAX_MEDIA = 10;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const HANDLE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const HANDLE_RESERVE_MS = 30 * 24 * 60 * 60 * 1000;
const ROLE_RANK: Record<CommunityRole, number> = { member: 1, moderator: 2, admin: 3, owner: 4 };

const createCommunitySchema = z.object({
  name: z.string().trim().min(3).max(80),
  handle: z.string().trim().toLowerCase().regex(HANDLE_REGEX),
  description: z.string().trim().max(500).default(''),
  membershipMode: z.enum(['open', 'approval_required', 'private']).default('open'),
  postingPolicy: z.enum(['everyone', 'mods_admins', 'admins_only']).default('everyone'),
  avatarMediaId: z.string().refine(ObjectId.isValid).optional(),
}).strict();

const updateCommunitySchema = createCommunitySchema.partial().extend({
  handle: z.string().trim().toLowerCase().regex(HANDLE_REGEX).optional(),
}).strict();

const inviteSchema = z.object({
  expiresIn: z.enum(['never', '1d', '7d', '30d']).default('7d'),
  maxUses: z.union([z.literal('unlimited'), z.literal(10), z.literal(50), z.literal(100)]).default(10),
}).strict();

const postSchema = z.object({
  body: z.string().max(POST_TEXT_LIMIT).optional(),
  mediaIds: z.array(z.string().refine(ObjectId.isValid)).max(MAX_MEDIA).default([]),
}).strict();
const commentSchema = z.object({ body: z.string().trim().min(1).max(COMMENT_TEXT_LIMIT) }).strict();
const reactionSchema = z.object({ emoji: z.enum(COMMUNITY_REACTION_EMOJIS) }).strict();
const roleSchema = z.object({ role: z.enum(['admin', 'moderator', 'member']) }).strict();
const restrictionSchema = z.object({ restricted: z.boolean() }).strict();

function parseSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError('Invalid community request');
  return parsed.data;
}

function requireUserId(req: Request, res: Response) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return null;
  }
  return new ObjectId(userId);
}

function normalizeHandle(handle: string) {
  return String(handle || '').trim().toLowerCase();
}

function activeUserQuery(extra: Record<string, unknown> = {}) {
  return { ...extra, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } };
}

async function loadActiveUser(userId: ObjectId) {
  return getUsersCollection().findOne(activeUserQuery({ _id: userId }) as any);
}

function publicUser(user: any) {
  return {
    id: user?._id?.toString(),
    name: user?.deletedAt ? 'Deleted user' : user?.name || user?.username || 'User',
    handle: user?.profileHandle || null,
    avatarUrl: user?.avatarUrl || null,
  };
}

async function ensureHandleAvailable(handle: string, currentCommunityId?: ObjectId) {
  if (!HANDLE_REGEX.test(handle) || RESERVED_HANDLES.has(handle)) return false;
  const [existing, reservation] = await Promise.all([
    getCommunitiesCollection().findOne({ handle, ...(currentCommunityId ? { _id: { $ne: currentCommunityId } } : {}) }),
    getCommunityHandleReservationsCollection().findOne({ handle, reservedUntil: { $gt: new Date() } }),
  ]);
  return !existing && !reservation;
}

async function validateAvatar(ownerUserId: ObjectId, avatarMediaId?: string) {
  if (!avatarMediaId) return undefined;
  const mediaId = new ObjectId(avatarMediaId);
  const media = await getDatabase().collection('media').findOne({
    _id: mediaId,
    userId: ownerUserId,
    status: 'approved',
    fileType: /^image\//,
  });
  if (!media) throw new ValidationError('Community avatar must be an approved image owned by you');
  return mediaId;
}

async function validatePostMedia(userId: ObjectId, mediaIds: string[]) {
  const objectIds = mediaIds.map((id) => new ObjectId(id));
  const unique = new Set(objectIds.map((id) => id.toString()));
  if (unique.size !== objectIds.length) throw new ValidationError('Community post media must be unique');
  if (!objectIds.length) return [];
  const media = await getDatabase().collection('media').find({
    _id: { $in: objectIds },
    userId,
    status: 'approved',
    fileType: /^image\//,
  }).project({ _id: 1 }).toArray();
  if (media.length !== objectIds.length) throw new ValidationError('Community photos must be approved images owned by you');
  return objectIds;
}

async function getMembership(communityId: ObjectId, userId: ObjectId) {
  return getCommunityMembershipsCollection().findOne({ communityId, userId });
}

async function isBanned(communityId: ObjectId, userId: ObjectId) {
  return Boolean(await getCommunityBansCollection().findOne({ communityId, userId }));
}

function canManageCommunity(role?: CommunityRole) {
  return role === 'owner' || role === 'admin';
}

function canModerate(role?: CommunityRole) {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

function canCreateContent(community: CommunityDocument, membership: CommunityMembershipDocument) {
  if (membership.postingRestricted) return false;
  if (community.postingPolicy === 'everyone') return true;
  if (community.postingPolicy === 'mods_admins') return ROLE_RANK[membership.role] >= ROLE_RANK.moderator;
  return ROLE_RANK[membership.role] >= ROLE_RANK.admin;
}

async function logActivity(communityId: ObjectId, actorUserId: ObjectId | undefined, action: string, targetUserId?: ObjectId, metadata?: Record<string, unknown>) {
  await getCommunityModerationActivityCollection().insertOne({
    _id: new ObjectId(),
    communityId,
    actorUserId,
    targetUserId,
    action,
    metadata,
    createdAt: new Date(),
  });
}

function publish(type: EventType | string, userIds: ObjectId[], data: Record<string, unknown>) {
  try {
    void getPubSub().publish(createEvent(type as EventType, { ...data, userIds: userIds.map((id) => id.toString()) }) as any);
  } catch (error) {
    logger.debug({ error, type }, 'Community event publish skipped');
  }
}

async function communityMemberIds(communityId: ObjectId) {
  const members = await getCommunityMembershipsCollection().find({ communityId }).project<{ userId: ObjectId }>({ userId: 1 }).toArray();
  return members.map((member) => member.userId);
}

async function loadCommunityByHandle(handle: string) {
  return getCommunitiesCollection().findOne({ handle: normalizeHandle(handle), deletedAt: { $exists: false } });
}

async function serializeCommunity(community: CommunityDocument, viewerUserId: ObjectId, membership?: CommunityMembershipDocument | null, previewOnly = false) {
  const [owner, pending] = await Promise.all([
    getUsersCollection().findOne(activeUserQuery({ _id: community.ownerUserId }) as any),
    getCommunityJoinRequestsCollection().findOne({ communityId: community._id, requesterUserId: viewerUserId, status: 'pending' }),
  ]);
  return {
    id: community._id.toString(),
    name: community.name,
    handle: community.handle,
    description: community.description,
    avatarUrl: community.avatarMediaId ? `/api/communities/${community.handle}/avatar/${community.avatarMediaId.toString()}` : null,
    membershipMode: community.membershipMode,
    postingPolicy: previewOnly ? undefined : community.postingPolicy,
    memberCount: community.memberCount,
    owner: previewOnly ? undefined : publicUser(owner),
    membership: membership ? { role: membership.role, postingRestricted: membership.postingRestricted, joinedAt: membership.joinedAt } : null,
    joinRequest: pending ? { status: 'pending', requestedAt: pending.createdAt } : null,
    canManage: canManageCommunity(membership?.role),
    canModerate: canModerate(membership?.role),
    canPost: membership ? canCreateContent(community, membership) : false,
    discovery: membership?.role === 'owner'
      ? {
          communityDiscoverable: Boolean(community.communityDiscoverable),
          topicIds: Array.isArray(community.communityTopicIds) ? community.communityTopicIds : [],
          updatedAt: community.discoverableUpdatedAt || null,
        }
      : undefined,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
  };
}

async function loadViewableCommunity(handle: string, viewerUserId: ObjectId) {
  const community = await loadCommunityByHandle(handle);
  if (!community) return { community: null };
  const [viewer, membership, banned] = await Promise.all([
    loadActiveUser(viewerUserId),
    getMembership(community._id, viewerUserId),
    isBanned(community._id, viewerUserId),
  ]);
  if (!viewer || banned) return { community: null };
  if (membership) return { community, membership, previewOnly: false };
  if (community.membershipMode === 'private') return { community: null };
  if (await hasBlockBetween(viewerUserId, community.ownerUserId)) return { community: null };
  return { community, membership: null, previewOnly: true };
}

async function loadMemberCommunity(handle: string, viewerUserId: ObjectId) {
  const loaded = await loadViewableCommunity(handle, viewerUserId);
  if (!loaded.community || !loaded.membership || loaded.previewOnly) return null;
  return loaded as { community: CommunityDocument; membership: CommunityMembershipDocument; previewOnly: false };
}

async function recomputeMemberCount(communityId: ObjectId) {
  const memberCount = await getCommunityMembershipsCollection().countDocuments({ communityId });
  await getCommunitiesCollection().updateOne({ _id: communityId }, { $set: { memberCount, updatedAt: new Date() } });
  return memberCount;
}

async function recomputePostCounts(postId: ObjectId) {
  const [commentCount, reactionCounts] = await Promise.all([
    getCommunityPostCommentsCollection().countDocuments({ communityPostId: postId, deletedAt: { $exists: false } }),
    getCommunityPostReactionsCollection().aggregate<{ _id: string; count: number }>([
      { $match: { communityPostId: postId } },
      { $group: { _id: '$emoji', count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const counts: Record<string, number> = {};
  for (const item of reactionCounts) if (item.count > 0) counts[item._id] = item.count;
  await getCommunityPostsCollection().updateOne({ _id: postId }, { $set: { commentCount, reactionCounts: counts, updatedAt: new Date() } });
  return { commentCount, reactionCounts: counts };
}

async function canViewerReadPost(post: CommunityPostDocument, viewerUserId: ObjectId) {
  if (post.deletedAt) return false;
  const [community, membership, author] = await Promise.all([
    getCommunitiesCollection().findOne({ _id: post.communityId, deletedAt: { $exists: false } }),
    getMembership(post.communityId, viewerUserId),
    loadActiveUser(post.authorUserId),
  ]);
  if (!community || !membership || !author) return false;
  if (await isBanned(post.communityId, viewerUserId)) return false;
  if (!viewerUserId.equals(post.authorUserId) && await hasBlockBetween(viewerUserId, post.authorUserId)) return false;
  return true;
}

export async function loadReadableCommunityPost(postId: ObjectId, viewerUserId: ObjectId) {
  const post = await getCommunityPostsCollection().findOne({ _id: postId, deletedAt: { $exists: false } });
  if (!post || !(await canViewerReadPost(post, viewerUserId))) return null;
  return post;
}

async function serializePost(post: CommunityPostDocument, viewerUserId: ObjectId) {
  const [author, membership, reaction] = await Promise.all([
    getUsersCollection().findOne({ _id: post.authorUserId }),
    getMembership(post.communityId, viewerUserId),
    getCommunityPostReactionsCollection().findOne({ communityPostId: post._id, reactingUserId: viewerUserId }),
  ]);
  if (!author || (!viewerUserId.equals(post.authorUserId) && await hasBlockBetween(viewerUserId, post.authorUserId))) return null;
  return {
    id: post._id.toString(),
    communityId: post.communityId.toString(),
    author: publicUser(author),
    body: post.body,
    media: post.mediaIds.map((mediaId) => ({ mediaId: mediaId.toString(), type: 'image', url: `/api/community-posts/${post._id.toString()}/media/${mediaId.toString()}` })),
    commentCount: post.commentCount || 0,
    reactionCounts: post.reactionCounts || {},
    myReaction: reaction?.emoji || null,
    canEdit: viewerUserId.equals(post.authorUserId) && Date.now() - post.createdAt.getTime() <= EDIT_WINDOW_MS,
    canDelete: viewerUserId.equals(post.authorUserId) || canModerate(membership?.role),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    editedAt: post.editedAt || null,
  };
}

async function serializeComment(comment: CommunityPostCommentDocument, viewerUserId: ObjectId, viewerRole?: CommunityRole) {
  const author = await getUsersCollection().findOne({ _id: comment.authorUserId });
  if (!author || (!viewerUserId.equals(comment.authorUserId) && await hasBlockBetween(viewerUserId, comment.authorUserId))) return null;
  return {
    id: comment._id.toString(),
    author: publicUser(author),
    body: comment.body,
    canDelete: viewerUserId.equals(comment.authorUserId) || canModerate(viewerRole),
    createdAt: comment.createdAt,
  };
}

export const listCommunities = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const memberships = await getCommunityMembershipsCollection().find({ userId }).toArray();
  const communities = memberships.length
    ? await getCommunitiesCollection().find({ _id: { $in: memberships.map((m) => m.communityId) }, deletedAt: { $exists: false } }).sort({ updatedAt: -1 }).toArray()
    : [];
  const pending = await getCommunityJoinRequestsCollection().find({ requesterUserId: userId, status: 'pending' }).toArray();
  const pendingCommunities = pending.length
    ? await getCommunitiesCollection().find({ _id: { $in: pending.map((r) => r.communityId) }, deletedAt: { $exists: false } }).toArray()
    : [];
  const membershipByCommunity = new Map(memberships.map((m) => [m.communityId.toString(), m]));
  res.status(200).json({
    communities: await Promise.all(communities.map((c) => serializeCommunity(c, userId, membershipByCommunity.get(c._id.toString())))),
    pending: await Promise.all(pendingCommunities.map((c) => serializeCommunity(c, userId, null, true))),
  });
});

export const createCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const user = await loadActiveUser(userId);
  if (!user || !(user as any).emailVerified || !user.profileHandle) throw new ValidationError('Verified account and profile handle required');
  const parsed = parseSchema(createCommunitySchema, req.body);
  if (!(await ensureHandleAvailable(parsed.handle))) {
    res.status(409).json({ error: 'Conflict', message: 'That Community handle is unavailable.' });
    return;
  }
  const now = new Date();
  const community: CommunityDocument = {
    _id: new ObjectId(),
    ownerUserId: userId,
    name: parsed.name,
    handle: parsed.handle,
    description: parsed.description,
    avatarMediaId: await validateAvatar(userId, parsed.avatarMediaId),
    membershipMode: parsed.membershipMode,
    postingPolicy: parsed.postingPolicy,
    memberCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  await getCommunitiesCollection().insertOne(community);
  await getCommunityMembershipsCollection().insertOne({
    _id: new ObjectId(),
    communityId: community._id,
    userId,
    role: 'owner',
    postingRestricted: false,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await logActivity(community._id, userId, 'community_created');
  publish('community:updated', [userId], { communityId: community._id.toString() });
  res.status(201).json({ community: await serializeCommunity(community, userId, await getMembership(community._id, userId)) });
});

export const getCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadViewableCommunity(req.params.handle, userId);
  if (!loaded.community) {
    res.status(404).json({ error: 'Not Found', message: 'Community unavailable' });
    return;
  }
  res.status(200).json({ community: await serializeCommunity(loaded.community, userId, loaded.membership, loaded.previewOnly) });
});

export const updateCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canManageCommunity(loaded.membership.role)) throw new ValidationError('Community settings are not available');
  const parsed = parseSchema(updateCommunitySchema, req.body);
  const set: Partial<CommunityDocument> = { updatedAt: new Date() };
  if (parsed.name !== undefined) set.name = parsed.name;
  if (parsed.description !== undefined) set.description = parsed.description;
  if (parsed.membershipMode !== undefined) set.membershipMode = parsed.membershipMode;
  if (parsed.membershipMode && parsed.membershipMode !== 'open') {
    set.communityDiscoverable = false;
    set.discoverableUpdatedAt = new Date();
  }
  if (parsed.postingPolicy !== undefined) set.postingPolicy = parsed.postingPolicy;
  if (parsed.avatarMediaId !== undefined) set.avatarMediaId = await validateAvatar(userId, parsed.avatarMediaId);
  if (parsed.handle && parsed.handle !== loaded.community.handle) {
    if (loaded.membership.role !== 'owner') throw new ValidationError('Only owners can change Community handles');
    if (loaded.community.handleChangedAt && Date.now() - loaded.community.handleChangedAt.getTime() < HANDLE_COOLDOWN_MS) throw new ValidationError('Community handle was changed recently');
    if (!(await ensureHandleAvailable(parsed.handle, loaded.community._id))) {
      res.status(409).json({ error: 'Conflict', message: 'That Community handle is unavailable.' });
      return;
    }
    await getCommunityHandleReservationsCollection().updateOne(
      { handle: loaded.community.handle },
      { $set: { reason: 'changed', reservedUntil: new Date(Date.now() + HANDLE_RESERVE_MS), createdAt: new Date() }, $setOnInsert: { _id: new ObjectId() } },
      { upsert: true }
    );
    set.handle = parsed.handle;
    set.handleChangedAt = new Date();
  }
  const community = await getCommunitiesCollection().findOneAndUpdate({ _id: loaded.community._id }, { $set: set }, { returnDocument: 'after' });
  await logActivity(loaded.community._id, userId, 'community_updated');
  publish('community:updated', await communityMemberIds(loaded.community._id), { communityId: loaded.community._id.toString() });
  res.status(200).json({ community: await serializeCommunity(community!, userId, loaded.membership) });
});

export const joinCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadViewableCommunity(req.params.handle, userId);
  if (!loaded.community || loaded.community.membershipMode !== 'open') {
    res.status(404).json({ error: 'Not Found', message: 'Community unavailable' });
    return;
  }
  if (loaded.membership) {
    res.status(200).json({ community: await serializeCommunity(loaded.community, userId, loaded.membership) });
    return;
  }
  const now = new Date();
  await getCommunityMembershipsCollection().updateOne(
    { communityId: loaded.community._id, userId },
    { $setOnInsert: { _id: new ObjectId(), communityId: loaded.community._id, userId, role: 'member', postingRestricted: false, joinedAt: now, createdAt: now }, $set: { updatedAt: now } },
    { upsert: true }
  );
  await getCommunityJoinRequestsCollection().deleteMany({ communityId: loaded.community._id, requesterUserId: userId, status: 'pending' });
  await recomputeMemberCount(loaded.community._id);
  await logActivity(loaded.community._id, userId, 'member_joined', userId);
  publish('community:membership-updated', await communityMemberIds(loaded.community._id), { communityId: loaded.community._id.toString() });
  res.status(200).json({ community: await serializeCommunity((await getCommunitiesCollection().findOne({ _id: loaded.community._id }))!, userId, await getMembership(loaded.community._id, userId)) });
});

export const requestJoinCommunity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadViewableCommunity(req.params.handle, userId);
  if (!loaded.community || loaded.community.membershipMode !== 'approval_required') {
    res.status(404).json({ error: 'Not Found', message: 'Community unavailable' });
    return;
  }
  if (loaded.membership) {
    res.status(200).json({ community: await serializeCommunity(loaded.community, userId, loaded.membership) });
    return;
  }
  const now = new Date();
  await getCommunityJoinRequestsCollection().updateOne(
    { communityId: loaded.community._id, requesterUserId: userId, status: 'pending' },
    { $setOnInsert: { _id: new ObjectId(), communityId: loaded.community._id, requesterUserId: userId, status: 'pending', createdAt: now }, $set: { updatedAt: now } },
    { upsert: true }
  );
  publish('community:join-request-updated', await communityMemberIds(loaded.community._id), { communityId: loaded.community._id.toString() });
  res.status(200).json({ community: await serializeCommunity(loaded.community, userId, null, true) });
});

export const cancelJoinRequest = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const community = await loadCommunityByHandle(req.params.handle);
  if (!community) {
    res.status(404).json({ error: 'Not Found', message: 'Community unavailable' });
    return;
  }
  await getCommunityJoinRequestsCollection().updateOne({ communityId: community._id, requesterUserId: userId, status: 'pending' }, { $set: { status: 'cancelled', updatedAt: new Date() } });
  res.status(204).send();
});

export const listJoinRequests = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canManageCommunity(loaded.membership.role)) throw new ValidationError('Join requests are not available');
  const requests = await getCommunityJoinRequestsCollection().find({ communityId: loaded.community._id, status: 'pending' }).sort({ createdAt: 1 }).toArray();
  const users = await getUsersCollection().find({ _id: { $in: requests.map((r) => r.requesterUserId) } }).toArray();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  res.status(200).json({ requests: requests.map((r) => ({ id: r._id.toString(), requester: publicUser(byId.get(r.requesterUserId.toString())), requestedAt: r.createdAt })) });
});

export const decideJoinRequest = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.requestUserId)) throw new ValidationError('Invalid requester');
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canManageCommunity(loaded.membership.role)) throw new ValidationError('Join requests are not available');
  const requesterUserId = new ObjectId(req.params.requestUserId);
  const approve = req.path.endsWith('/approve');
  await getCommunityJoinRequestsCollection().updateOne({ communityId: loaded.community._id, requesterUserId, status: 'pending' }, { $set: { status: approve ? 'approved' : 'declined', updatedAt: new Date() } });
  if (approve && !(await isBanned(loaded.community._id, requesterUserId))) {
    const now = new Date();
    await getCommunityMembershipsCollection().updateOne(
      { communityId: loaded.community._id, userId: requesterUserId },
      { $setOnInsert: { _id: new ObjectId(), communityId: loaded.community._id, userId: requesterUserId, role: 'member', postingRestricted: false, joinedAt: now, createdAt: now }, $set: { updatedAt: now } },
      { upsert: true }
    );
    await recomputeMemberCount(loaded.community._id);
  }
  await logActivity(loaded.community._id, userId, approve ? 'join_request_approved' : 'join_request_declined', requesterUserId);
  publish('community:join-request-updated', await communityMemberIds(loaded.community._id), { communityId: loaded.community._id.toString() });
  res.status(204).send();
});

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded) {
    res.status(404).json({ error: 'Not Found', message: 'Community unavailable' });
    return;
  }
  const memberships = await getCommunityMembershipsCollection().find({ communityId: loaded.community._id }).sort({ joinedAt: 1 }).toArray();
  const users = await getUsersCollection().find(activeUserQuery({ _id: { $in: memberships.map((m) => m.userId) } }) as any).toArray();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  res.status(200).json({ members: memberships.filter((m) => byId.has(m.userId.toString())).map((m) => ({ user: publicUser(byId.get(m.userId.toString())), role: m.role, postingRestricted: m.postingRestricted, joinedAt: m.joinedAt })) });
});

export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.memberUserId)) throw new ValidationError('Invalid member');
  const parsed = parseSchema(roleSchema, req.body);
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canManageCommunity(loaded.membership.role)) throw new ValidationError('Member roles are not available');
  const targetUserId = new ObjectId(req.params.memberUserId);
  const target = await getMembership(loaded.community._id, targetUserId);
  if (!target || target.role === 'owner') throw new ValidationError('Member role cannot be changed');
  if (loaded.membership.role !== 'owner' && (parsed.role === 'admin' || target.role === 'admin')) throw new ValidationError('Only owners can manage admins');
  await getCommunityMembershipsCollection().updateOne({ _id: target._id }, { $set: { role: parsed.role, updatedAt: new Date() } });
  await logActivity(loaded.community._id, userId, 'member_role_updated', targetUserId, { role: parsed.role });
  res.status(204).send();
});

export const updateMemberRestriction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.memberUserId)) throw new ValidationError('Invalid member');
  const parsed = parseSchema(restrictionSchema, req.body);
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canModerate(loaded.membership.role)) throw new ValidationError('Member restrictions are not available');
  const targetUserId = new ObjectId(req.params.memberUserId);
  const target = await getMembership(loaded.community._id, targetUserId);
  if (!target || target.role === 'owner' || ROLE_RANK[target.role] >= ROLE_RANK[loaded.membership.role]) throw new ValidationError('Member restriction is not available');
  await getCommunityMembershipsCollection().updateOne({ _id: target._id }, { $set: { postingRestricted: parsed.restricted, restrictedByUserId: parsed.restricted ? userId : undefined, restrictedAt: parsed.restricted ? new Date() : undefined, updatedAt: new Date() } });
  await logActivity(loaded.community._id, userId, parsed.restricted ? 'member_restricted' : 'member_unrestricted', targetUserId);
  res.status(204).send();
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.memberUserId)) throw new ValidationError('Invalid member');
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canModerate(loaded.membership.role)) throw new ValidationError('Member removal is not available');
  const targetUserId = new ObjectId(req.params.memberUserId);
  if (targetUserId.equals(userId)) throw new ValidationError('Use leave Community instead');
  const target = await getMembership(loaded.community._id, targetUserId);
  if (!target || target.role === 'owner' || ROLE_RANK[target.role] >= ROLE_RANK[loaded.membership.role]) throw new ValidationError('Member removal is not available');
  await getCommunityMembershipsCollection().deleteOne({ _id: target._id });
  await getCommunityJoinRequestsCollection().deleteMany({ communityId: loaded.community._id, requesterUserId: targetUserId, status: 'pending' });
  await recomputeMemberCount(loaded.community._id);
  await logActivity(loaded.community._id, userId, 'member_removed', targetUserId);
  res.status(204).send();
});

export const banMember = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.memberUserId)) throw new ValidationError('Invalid member');
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || loaded.membership.role !== 'owner' && loaded.membership.role !== 'admin') throw new ValidationError('Member ban is not available');
  const targetUserId = new ObjectId(req.params.memberUserId);
  const target = await getMembership(loaded.community._id, targetUserId);
  if (target?.role === 'owner' || (target && ROLE_RANK[target.role] >= ROLE_RANK[loaded.membership.role])) throw new ValidationError('Member ban is not available');
  await getCommunityMembershipsCollection().deleteOne({ communityId: loaded.community._id, userId: targetUserId });
  await getCommunityJoinRequestsCollection().deleteMany({ communityId: loaded.community._id, requesterUserId: targetUserId });
  await getCommunityBansCollection().updateOne(
    { communityId: loaded.community._id, userId: targetUserId },
    { $setOnInsert: { _id: new ObjectId(), communityId: loaded.community._id, userId: targetUserId, bannedByUserId: userId, createdAt: new Date() } },
    { upsert: true }
  );
  await recomputeMemberCount(loaded.community._id);
  await logActivity(loaded.community._id, userId, 'member_banned', targetUserId);
  res.status(204).send();
});

export const listActivity = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canManageCommunity(loaded.membership.role)) throw new ValidationError('Activity is not available');
  const logs = await getCommunityModerationActivityCollection().find({ communityId: loaded.community._id }).sort({ createdAt: -1 }).limit(100).toArray();
  const userIds = Array.from(new Set(logs.flatMap((log) => [log.actorUserId, log.targetUserId]).filter(Boolean).map((id) => id!.toString()))).map((id) => new ObjectId(id));
  const users = userIds.length ? await getUsersCollection().find({ _id: { $in: userIds } }).toArray() : [];
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  res.status(200).json({ activity: logs.map((log) => ({ id: log._id.toString(), action: log.action, actor: log.actorUserId ? publicUser(byId.get(log.actorUserId.toString())) : null, target: log.targetUserId ? publicUser(byId.get(log.targetUserId.toString())) : null, metadata: log.metadata || {}, createdAt: log.createdAt })) });
});

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function inviteExpiry(value: string) {
  if (value === 'never') return undefined;
  const days = value === '1d' ? 1 : value === '7d' ? 7 : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const createInvite = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = parseSchema(inviteSchema, req.body || {});
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canManageCommunity(loaded.membership.role)) throw new ValidationError('Invites are not available');
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await getCommunityInvitesCollection().updateMany({ communityId: loaded.community._id, revokedAt: { $exists: false } }, { $set: { revokedAt: now, updatedAt: now } });
  const invite = {
    _id: new ObjectId(),
    communityId: loaded.community._id,
    tokenHash: hashToken(token),
    createdByUserId: userId,
    expiresAt: inviteExpiry(parsed.expiresIn),
    maxUses: parsed.maxUses === 'unlimited' ? undefined : parsed.maxUses,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await getCommunityInvitesCollection().insertOne(invite);
  await logActivity(loaded.community._id, userId, 'invite_created');
  res.status(201).json({ invite: { createdAt: invite.createdAt, expiresAt: invite.expiresAt || null, maxUses: invite.maxUses || null, useCount: invite.useCount }, token });
});

async function loadValidInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token || '')) return null;
  const invite = await getCommunityInvitesCollection().findOne({ tokenHash: hashToken(token), revokedAt: { $exists: false } });
  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt <= new Date()) return null;
  if (invite.maxUses !== undefined && invite.useCount >= invite.maxUses) return null;
  const community = await getCommunitiesCollection().findOne({ _id: invite.communityId, deletedAt: { $exists: false } });
  if (!community) return null;
  return { invite, community };
}

export const previewInvite = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadValidInvite(req.params.token);
  if (!loaded || await isBanned(loaded.community._id, userId)) {
    res.status(404).json({ error: 'Not Found', message: 'Invite unavailable' });
    return;
  }
  res.status(200).json({ community: await serializeCommunity(loaded.community, userId, await getMembership(loaded.community._id, userId), true) });
});

export const acceptInvite = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadValidInvite(req.params.token);
  if (!loaded || await isBanned(loaded.community._id, userId)) {
    res.status(404).json({ error: 'Not Found', message: 'Invite unavailable' });
    return;
  }
  const existing = await getMembership(loaded.community._id, userId);
  if (!existing) {
    const invite = await getCommunityInvitesCollection().findOneAndUpdate(
      { _id: loaded.invite._id, revokedAt: { $exists: false }, ...(loaded.invite.expiresAt ? { expiresAt: { $gt: new Date() } } : {}), ...(loaded.invite.maxUses !== undefined ? { useCount: { $lt: loaded.invite.maxUses } } : {}) },
      { $inc: { useCount: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!invite) {
      res.status(404).json({ error: 'Not Found', message: 'Invite unavailable' });
      return;
    }
    const now = new Date();
    await getCommunityMembershipsCollection().insertOne({ _id: new ObjectId(), communityId: loaded.community._id, userId, role: 'member', postingRestricted: false, joinedAt: now, createdAt: now, updatedAt: now });
    await recomputeMemberCount(loaded.community._id);
  }
  res.status(200).json({ community: await serializeCommunity((await getCommunitiesCollection().findOne({ _id: loaded.community._id }))!, userId, await getMembership(loaded.community._id, userId)) });
});

export const listCommunityPosts = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded) {
    res.status(404).json({ error: 'Not Found', message: 'Community unavailable' });
    return;
  }
  const posts = await getCommunityPostsCollection().find({ communityId: loaded.community._id, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(30).toArray();
  const serialized = [];
  for (const post of posts) {
    const item = await serializePost(post, userId);
    if (item) serialized.push(item);
  }
  res.status(200).json({ posts: serialized, nextCursor: null });
});

export const createCommunityPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = parseSchema(postSchema, req.body);
  const body = String(parsed.body || '').replace(/\r\n?/g, '\n').trim();
  if (!body && parsed.mediaIds.length === 0) throw new ValidationError('Community post needs text or photos');
  const loaded = await loadMemberCommunity(req.params.handle, userId);
  if (!loaded || !canCreateContent(loaded.community, loaded.membership)) throw new ValidationError('Posting is not available');
  const now = new Date();
  const post: CommunityPostDocument = {
    _id: new ObjectId(),
    communityId: loaded.community._id,
    authorUserId: userId,
    body,
    mediaIds: await validatePostMedia(userId, parsed.mediaIds),
    commentCount: 0,
    reactionCounts: {},
    createdAt: now,
    updatedAt: now,
  };
  await getCommunityPostsCollection().insertOne(post);
  publish('community:posts-updated', await communityMemberIds(loaded.community._id), { communityId: loaded.community._id.toString() });
  res.status(201).json({ post: await serializePost(post, userId) });
});

export const getCommunityPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  res.status(200).json({ post: await serializePost(post, userId) });
});

export const updateCommunityPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(z.object({ body: z.string().max(POST_TEXT_LIMIT) }).strict(), req.body);
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  if (!post || !post.authorUserId.equals(userId) || Date.now() - post.createdAt.getTime() > EDIT_WINDOW_MS) throw new ValidationError('Post cannot be edited');
  const updated = await getCommunityPostsCollection().findOneAndUpdate({ _id: post._id }, { $set: { body: parsed.body.trim(), editedAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' });
  res.status(200).json({ post: await serializePost(updated!, userId) });
});

export const deleteCommunityPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await getCommunityPostsCollection().findOne({ _id: new ObjectId(req.params.postId), deletedAt: { $exists: false } });
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const membership = await getMembership(post.communityId, userId);
  if (!membership || (!post.authorUserId.equals(userId) && !canModerate(membership.role))) throw new ValidationError('Post cannot be deleted');
  await getCommunityPostsCollection().updateOne({ _id: post._id }, { $set: { deletedAt: new Date(), removedByUserId: post.authorUserId.equals(userId) ? undefined : userId, updatedAt: new Date() } });
  if (!post.authorUserId.equals(userId)) await logActivity(post.communityId, userId, 'post_removed', post.authorUserId);
  res.status(204).send();
});

export const getCommunityPostMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId) || !ObjectId.isValid(req.params.mediaId)) throw new ValidationError('Invalid media request');
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  const mediaId = new ObjectId(req.params.mediaId);
  if (!post || !post.mediaIds.some((id) => id.equals(mediaId))) {
    res.status(404).json({ error: 'Not Found', message: 'Media not found' });
    return;
  }
  const media = await getDatabase().collection('media').findOne({ _id: mediaId, status: 'approved', fileType: /^image\// });
  if (!media) {
    res.status(404).json({ error: 'Not Found', message: 'Media not found' });
    return;
  }
  const baseUrl = (process.env.MEDIA_SERVICE_URL || 'http://media:3000').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/local/${mediaId.toString()}`, {
    headers: process.env.MOMENT_INTERNAL_MEDIA_TOKEN ? { 'x-moment-internal-token': process.env.MOMENT_INTERNAL_MEDIA_TOKEN } : undefined,
  });
  if (!response.ok || !response.body) {
    res.status(404).json({ error: 'Not Found', message: 'Media not found' });
    return;
  }
  res.setHeader('Content-Type', response.headers.get('content-type') || media.fileType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).send(Buffer.from(await response.arrayBuffer()));
});

export const getCommunityAvatar = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.mediaId)) throw new ValidationError('Invalid media request');
  const loaded = await loadViewableCommunity(req.params.handle, userId);
  const mediaId = new ObjectId(req.params.mediaId);
  if (!loaded.community || !loaded.community.avatarMediaId?.equals(mediaId)) {
    res.status(404).json({ error: 'Not Found', message: 'Media not found' });
    return;
  }
  const baseUrl = (process.env.MEDIA_SERVICE_URL || 'http://media:3000').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/local/${mediaId.toString()}`, {
    headers: process.env.MOMENT_INTERNAL_MEDIA_TOKEN ? { 'x-moment-internal-token': process.env.MOMENT_INTERNAL_MEDIA_TOKEN } : undefined,
  });
  if (!response.ok || !response.body) {
    res.status(404).json({ error: 'Not Found', message: 'Media not found' });
    return;
  }
  res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).send(Buffer.from(await response.arrayBuffer()));
});

export const setCommunityPostReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(reactionSchema, req.body);
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const now = new Date();
  await getCommunityPostReactionsCollection().updateOne(
    { communityPostId: post._id, reactingUserId: userId },
    { $set: { emoji: parsed.emoji, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), communityId: post.communityId, communityPostId: post._id, postAuthorUserId: post.authorUserId, reactingUserId: userId, createdAt: now } },
    { upsert: true }
  );
  const counts = await recomputePostCounts(post._id);
  publish('community:post-interaction-updated', await communityMemberIds(post.communityId), { communityId: post.communityId.toString(), postId: post._id.toString() });
  res.status(200).json({ reactionCounts: counts.reactionCounts, myReaction: parsed.emoji });
});

export const removeCommunityPostReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  await getCommunityPostReactionsCollection().deleteOne({ communityPostId: post._id, reactingUserId: userId });
  const counts = await recomputePostCounts(post._id);
  res.status(200).json({ reactionCounts: counts.reactionCounts, myReaction: null });
});

export const listCommunityPostComments = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const membership = await getMembership(post.communityId, userId);
  const comments = await getCommunityPostCommentsCollection().find({ communityPostId: post._id, deletedAt: { $exists: false } }).sort({ createdAt: 1 }).limit(100).toArray();
  const serialized = [];
  for (const comment of comments) {
    const item = await serializeComment(comment, userId, membership?.role);
    if (item) serialized.push(item);
  }
  res.status(200).json({ comments: serialized });
});

export const createCommunityPostComment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(commentSchema, req.body);
  const post = await loadReadableCommunityPost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const [community, membership] = await Promise.all([getCommunitiesCollection().findOne({ _id: post.communityId }), getMembership(post.communityId, userId)]);
  if (!community || !membership || !canCreateContent(community, membership)) throw new ValidationError('Commenting is not available');
  const now = new Date();
  const comment: CommunityPostCommentDocument = { _id: new ObjectId(), communityId: post.communityId, communityPostId: post._id, authorUserId: userId, body: parsed.body, createdAt: now, updatedAt: now };
  await getCommunityPostCommentsCollection().insertOne(comment);
  await recomputePostCounts(post._id);
  res.status(201).json({ comment: await serializeComment(comment, userId, membership.role) });
});

export const deleteCommunityPostComment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId) || !ObjectId.isValid(req.params.commentId)) throw new ValidationError('Invalid comment ID');
  const comment = await getCommunityPostCommentsCollection().findOne({ _id: new ObjectId(req.params.commentId), communityPostId: new ObjectId(req.params.postId), deletedAt: { $exists: false } });
  if (!comment) {
    res.status(404).json({ error: 'Not Found', message: 'Comment not found' });
    return;
  }
  const membership = await getMembership(comment.communityId, userId);
  if (!membership || (!comment.authorUserId.equals(userId) && !canModerate(membership.role))) throw new ValidationError('Comment cannot be deleted');
  await getCommunityPostCommentsCollection().updateOne({ _id: comment._id }, { $set: { deletedAt: new Date(), deletedByUserId: userId, updatedAt: new Date() } });
  await recomputePostCounts(comment.communityPostId);
  res.status(204).send();
});
