import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ValidationError,
  asyncHandler,
  createEvent,
  logger,
} from '@repo/utils';
import {
  EventType,
  FollowRequestUpdatedEvent,
  FollowUpdatedEvent,
  ProfileUpdatedEvent,
} from '@repo/types';
import { getUsersCollection, User } from '../models/user';
import { hasBlockBetween } from '../models/user-block';
import {
  ProfileRelationship,
  getProfileRelationshipsCollection,
} from '../models/profile-relationship';
import {
  cleanupExpiredProfileHandleReservations,
  getProfileHandleReservationsCollection,
} from '../models/profile-handle-reservation';
import { getPubSub } from '../pubsub';

const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
const HANDLE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const HANDLE_RESERVATION_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 50;
const RESERVED_HANDLES = new Set([
  'admin',
  'administrator',
  'moderator',
  'support',
  'help',
  'system',
  'settings',
  'profile',
  'profiles',
  'moments',
  'chats',
  'messages',
  'search',
  'moderation',
  'api',
  'auth',
  'login',
  'signup',
  'register',
  'notifications',
  'assets',
  'static',
  'blabber',
  'healthz',
  'readyz',
  'users',
  'reports',
  'media',
  'invites',
  'calls',
  'intelligence',
]);

const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(160).optional(),
  website: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .transform((value) => (value ? value : undefined)),
  visibility: z.enum(['private', 'public']).optional(),
});

const UpdateHandleSchema = z.object({
  handle: z.string().trim().toLowerCase(),
});

function requireUserId(req: Request) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) throw new UnauthorizedError('User not authenticated');
  return new ObjectId(userId);
}

function canonicalHandle(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function validateHandle(value: string) {
  const handle = canonicalHandle(value);
  if (!HANDLE_RE.test(handle) || RESERVED_HANDLES.has(handle)) {
    throw new ValidationError('That handle is not available.');
  }
  return handle;
}

function validateWebsite(value?: string) {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError('Website must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') throw new ValidationError('Website must be a valid HTTPS URL.');
  return parsed.toString();
}

function activeUserQuery(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    deletedAt: { $exists: false },
    deactivatedAt: { $exists: false },
  };
}

async function requireActiveUser(userId: ObjectId) {
  const user = await getUsersCollection().findOne(activeUserQuery({ _id: userId }) as any);
  if (!user) throw new UnauthorizedError('User not found');
  return user;
}

async function findActiveUserByHandle(handle: string) {
  return getUsersCollection().findOne(activeUserQuery({ profileHandle: canonicalHandle(handle) }) as any);
}

function userIdentity(user: User) {
  return {
    name: user.name,
    handle: user.profileHandle || null,
    displayHandle: user.profileHandle ? `@${user.profileHandle}` : null,
    avatarUrl: user.avatarUrl || null,
  };
}

async function relationshipBetween(viewerUserId: ObjectId, targetUserId: ObjectId) {
  if (viewerUserId.equals(targetUserId)) return { kind: 'self' as const };
  const relationships = await getProfileRelationshipsCollection()
    .find({
      $or: [
        { followerUserId: viewerUserId, targetUserId },
        { followerUserId: targetUserId, targetUserId: viewerUserId },
      ],
    })
    .toArray();
  const outgoing = relationships.find((item) => item.followerUserId.equals(viewerUserId));
  const incoming = relationships.find((item) => item.followerUserId.equals(targetUserId));
  if (outgoing?.state === 'following') return { kind: 'following' as const, outgoing };
  if (outgoing?.state === 'requested') return { kind: 'requested_outgoing' as const, outgoing };
  if (incoming?.state === 'requested') return { kind: 'requested_incoming' as const, incoming };
  return { kind: 'none' as const };
}

async function profileCounts(targetUserId: ObjectId) {
  const [followers, following, pendingRequests] = await Promise.all([
    getProfileRelationshipsCollection().countDocuments({ targetUserId, state: 'following' }),
    getProfileRelationshipsCollection().countDocuments({ followerUserId: targetUserId, state: 'following' }),
    getProfileRelationshipsCollection().countDocuments({ targetUserId, state: 'requested' }),
  ]);
  return { followers, following, pendingRequests };
}

function serializeFullProfile(user: User, relationship: string, counts: Awaited<ReturnType<typeof profileCounts>>) {
  return {
    ...userIdentity(user),
    bio: user.profileBio || '',
    website: user.profileWebsite || null,
    visibility: user.profileVisibility || 'private',
    relationship,
    counts,
    profileUpdatedAt: user.profileUpdatedAt || user.updatedAt,
    handleChangedAt: user.profileHandleChangedAt || null,
  };
}

function serializeLockedProfile(user: User, relationship: string) {
  return {
    ...userIdentity(user),
    relationship,
    locked: true,
    message: 'This profile is private.',
  };
}

function serializePublicProfile(user: User, relationship: string, counts: Awaited<ReturnType<typeof profileCounts>>) {
  return {
    ...userIdentity(user),
    bio: user.profileBio || '',
    website: user.profileWebsite || null,
    visibility: user.profileVisibility || 'private',
    relationship,
    counts: {
      followers: counts.followers,
      following: counts.following,
    },
    profileUpdatedAt: user.profileUpdatedAt || user.updatedAt,
  };
}

async function serializeProfileForViewer(user: User, viewerUserId: ObjectId) {
  if (await hasBlockBetween(viewerUserId, user._id)) {
    throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  }
  const relationship = await relationshipBetween(viewerUserId, user._id);
  const visibility = user.profileVisibility || 'private';
  if (relationship.kind === 'self') return { profile: serializeFullProfile(user, 'self', await profileCounts(user._id)) };
  if (relationship.kind === 'following') {
    return { profile: serializeFullProfile(user, 'following', await profileCounts(user._id)) };
  }
  if (visibility === 'public') {
    return { profile: serializePublicProfile(user, relationship.kind, await profileCounts(user._id)) };
  }
  const rel = relationship.kind === 'requested_outgoing' ? 'requested_outgoing' : 'none';
  return { profile: serializeLockedProfile(user, rel) };
}

async function publishProfileUpdate(userIds: string[], type: EventType.PROFILE_UPDATED | EventType.FOLLOW_UPDATED | EventType.FOLLOW_REQUEST_UPDATED) {
  try {
    if (type === EventType.PROFILE_UPDATED) {
      await getPubSub().publish(createEvent<ProfileUpdatedEvent>(type, { userId: userIds[0] }));
    } else if (type === EventType.FOLLOW_REQUEST_UPDATED) {
      await getPubSub().publish(createEvent<FollowRequestUpdatedEvent>(type, { userIds }));
    } else {
      await getPubSub().publish(createEvent<FollowUpdatedEvent>(type, { userIds }));
    }
  } catch (error) {
    logger.error({ error, type }, 'Failed to publish profile event');
  }
}

async function reserveHandle(handle: string, reason: 'changed' | 'deleted', now = new Date()) {
  await getProfileHandleReservationsCollection().updateOne(
    { handle },
    {
      $set: { reason, reservedUntil: new Date(now.getTime() + HANDLE_RESERVATION_MS), createdAt: now },
      $setOnInsert: { _id: new ObjectId() },
    },
    { upsert: true }
  );
}

async function ensureHandleAvailable(handle: string, currentUserId: ObjectId) {
  await cleanupExpiredProfileHandleReservations();
  const [existing, reservation] = await Promise.all([
    getUsersCollection().findOne({ profileHandle: handle }),
    getProfileHandleReservationsCollection().findOne({ handle, reservedUntil: { $gt: new Date() } }),
  ]);
  if (existing && !existing._id.equals(currentUserId)) throw new ConflictError('That handle is not available.');
  if (reservation) throw new ConflictError('That handle is not available.');
}

export const getMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireActiveUser(requireUserId(req));
  res.status(200).json({ profile: serializeFullProfile(user, 'self', await profileCounts(user._id)) });
});

export const updateMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  await requireActiveUser(userId);
  const parsed = UpdateProfileSchema.parse(req.body);
  const update: any = { updatedAt: new Date(), profileUpdatedAt: new Date() };
  if (parsed.name !== undefined) update.name = parsed.name;
  if (parsed.bio !== undefined) update.profileBio = parsed.bio || undefined;
  if (parsed.website !== undefined) update.profileWebsite = validateWebsite(parsed.website);
  if (parsed.visibility !== undefined) update.profileVisibility = parsed.visibility;
  const unset: Record<string, ''> = {};
  if (parsed.bio === '') unset.profileBio = '';
  if (!parsed.website && 'website' in parsed) unset.profileWebsite = '';
  const result = await getUsersCollection().findOneAndUpdate(
    { _id: userId },
    { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' }
  );
  await publishProfileUpdate([userId.toString()], EventType.PROFILE_UPDATED);
  res.status(200).json({ profile: serializeFullProfile(result!, 'self', await profileCounts(userId)) });
});

export const updateMyHandle = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const user = await requireActiveUser(userId);
  const handle = validateHandle(UpdateHandleSchema.parse(req.body).handle);
  if (user.profileHandle === handle) {
    res.status(200).json({ profile: serializeFullProfile(user, 'self', await profileCounts(user._id)) });
    return;
  }
  if (user.profileHandleChangedAt && Date.now() - user.profileHandleChangedAt.getTime() < HANDLE_COOLDOWN_MS) {
    throw new AppError(429, 'You can change your handle once every 14 days.', 'HANDLE_COOLDOWN');
  }
  await ensureHandleAvailable(handle, userId);
  const now = new Date();
  if (user.profileHandle) await reserveHandle(user.profileHandle, 'changed', now);
  const result = await getUsersCollection().findOneAndUpdate(
    { _id: userId },
    {
      $set: {
        profileHandle: handle,
        profileHandleChangedAt: now,
        profileUpdatedAt: now,
        profileVisibility: user.profileVisibility || 'private',
        updatedAt: now,
      },
    },
    { returnDocument: 'after' }
  );
  await publishProfileUpdate([userId.toString()], EventType.PROFILE_UPDATED);
  res.status(200).json({ profile: serializeFullProfile(result!, 'self', await profileCounts(userId)) });
});

export const getProfileByHandle = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const user = await findActiveUserByHandle(req.params.handle);
  if (!user) throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  res.status(200).json(await serializeProfileForViewer(user, viewerUserId));
});

export const followProfile = asyncHandler(async (req: Request, res: Response) => {
  const followerUserId = requireUserId(req);
  await requireActiveUser(followerUserId);
  const target = await findActiveUserByHandle(req.params.handle);
  if (!target || target._id.equals(followerUserId) || await hasBlockBetween(followerUserId, target._id)) {
    throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  }
  const now = new Date();
  const state = (target.profileVisibility || 'private') === 'public' ? 'following' : 'requested';
  await getProfileRelationshipsCollection().updateOne(
    { followerUserId, targetUserId: target._id },
    {
      $setOnInsert: { _id: new ObjectId(), followerUserId, targetUserId: target._id, createdAt: now },
      $set: { state, updatedAt: now, ...(state === 'following' ? { approvedAt: now } : {}) },
    },
    { upsert: true }
  );
  await publishProfileUpdate(
    [followerUserId.toString(), target._id.toString()],
    state === 'requested' ? EventType.FOLLOW_REQUEST_UPDATED : EventType.FOLLOW_UPDATED
  );
  res.status(200).json(await serializeProfileForViewer(target, followerUserId));
});

export const unfollowProfile = asyncHandler(async (req: Request, res: Response) => {
  const followerUserId = requireUserId(req);
  await requireActiveUser(followerUserId);
  const target = await findActiveUserByHandle(req.params.handle);
  if (!target || target._id.equals(followerUserId)) throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  await getProfileRelationshipsCollection().deleteOne({ followerUserId, targetUserId: target._id, state: 'following' });
  await publishProfileUpdate([followerUserId.toString(), target._id.toString()], EventType.FOLLOW_UPDATED);
  res.status(200).json(await serializeProfileForViewer(target, followerUserId));
});

export const cancelFollowRequest = asyncHandler(async (req: Request, res: Response) => {
  const followerUserId = requireUserId(req);
  await requireActiveUser(followerUserId);
  const target = await findActiveUserByHandle(req.params.handle);
  if (!target || target._id.equals(followerUserId)) throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  await getProfileRelationshipsCollection().deleteOne({ followerUserId, targetUserId: target._id, state: 'requested' });
  await publishProfileUpdate([followerUserId.toString(), target._id.toString()], EventType.FOLLOW_REQUEST_UPDATED);
  res.status(200).json(await serializeProfileForViewer(target, followerUserId));
});

async function requestByHandle(ownerUserId: ObjectId, requesterHandle: string) {
  const requester = await findActiveUserByHandle(requesterHandle);
  if (!requester || await hasBlockBetween(ownerUserId, requester._id)) throw new AppError(404, 'Follow request is unavailable.', 'FOLLOW_REQUEST_UNAVAILABLE');
  return requester;
}

export const approveFollowRequest = asyncHandler(async (req: Request, res: Response) => {
  const ownerUserId = requireUserId(req);
  await requireActiveUser(ownerUserId);
  const requester = await requestByHandle(ownerUserId, req.params.requesterHandle);
  const now = new Date();
  const result = await getProfileRelationshipsCollection().updateOne(
    { followerUserId: requester._id, targetUserId: ownerUserId, state: 'requested' },
    { $set: { state: 'following', approvedAt: now, updatedAt: now } }
  );
  if (result.matchedCount) await publishProfileUpdate([ownerUserId.toString(), requester._id.toString()], EventType.FOLLOW_UPDATED);
  res.status(200).json({ success: true });
});

export const declineFollowRequest = asyncHandler(async (req: Request, res: Response) => {
  const ownerUserId = requireUserId(req);
  await requireActiveUser(ownerUserId);
  const requester = await requestByHandle(ownerUserId, req.params.requesterHandle);
  await getProfileRelationshipsCollection().deleteOne({ followerUserId: requester._id, targetUserId: ownerUserId, state: 'requested' });
  await publishProfileUpdate([ownerUserId.toString(), requester._id.toString()], EventType.FOLLOW_REQUEST_UPDATED);
  res.status(200).json({ success: true });
});

export const removeFollower = asyncHandler(async (req: Request, res: Response) => {
  const ownerUserId = requireUserId(req);
  await requireActiveUser(ownerUserId);
  const follower = await requestByHandle(ownerUserId, req.params.handle);
  await getProfileRelationshipsCollection().deleteOne({ followerUserId: follower._id, targetUserId: ownerUserId, state: 'following' });
  await publishProfileUpdate([ownerUserId.toString(), follower._id.toString()], EventType.FOLLOW_UPDATED);
  res.status(200).json({ success: true });
});

function cursorFilter(cursor?: string) {
  if (!cursor) return {};
  if (!ObjectId.isValid(cursor)) throw new ValidationError('Invalid cursor.');
  return { _id: { $gt: new ObjectId(cursor) } };
}

function serializeListUser(user: User) {
  return userIdentity(user);
}

async function assertCanSeeLists(viewerUserId: ObjectId, target: User) {
  if (await hasBlockBetween(viewerUserId, target._id)) throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  if (viewerUserId.equals(target._id)) return;
  const rel = await getProfileRelationshipsCollection().findOne({ followerUserId: viewerUserId, targetUserId: target._id, state: 'following' });
  if (!rel) throw new AppError(403, 'This list is private.', 'PROFILE_LIST_PRIVATE');
}

async function listRelationships(params: {
  viewerUserId: ObjectId;
  target: User;
  direction: 'followers' | 'following';
  cursor?: string;
}) {
  await assertCanSeeLists(params.viewerUserId, params.target);
  const field = params.direction === 'followers' ? 'targetUserId' : 'followerUserId';
  const projectionField = params.direction === 'followers' ? 'followerUserId' : 'targetUserId';
  const relationships = await getProfileRelationshipsCollection()
    .find({ [field]: params.target._id, state: 'following', ...cursorFilter(params.cursor) } as any)
    .sort({ _id: 1 })
    .limit(PAGE_LIMIT + 1)
    .toArray();
  const page = relationships.slice(0, PAGE_LIMIT);
  const ids = page.map((relationship: any) => relationship[projectionField] as ObjectId);
  const users = await getUsersCollection()
    .find(activeUserQuery({ _id: { $in: ids } }) as any)
    .project<User>({ name: 1, profileHandle: 1, avatarUrl: 1 })
    .toArray();
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  const visibleUsers = page
    .map((relationship: any) => byId.get(relationship[projectionField].toString()))
    .filter((user): user is User => Boolean(user));
  return {
    users: visibleUsers.map(serializeListUser),
    nextCursor: relationships.length > PAGE_LIMIT ? page[page.length - 1]._id.toString() : null,
  };
}

export const listFollowers = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const target = await findActiveUserByHandle(req.params.handle);
  if (!target) throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  res.status(200).json(await listRelationships({ viewerUserId, target, direction: 'followers', cursor: req.query.cursor as string | undefined }));
});

export const listFollowing = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = requireUserId(req);
  await requireActiveUser(viewerUserId);
  const target = await findActiveUserByHandle(req.params.handle);
  if (!target) throw new AppError(404, 'Profile is unavailable.', 'PROFILE_UNAVAILABLE');
  res.status(200).json(await listRelationships({ viewerUserId, target, direction: 'following', cursor: req.query.cursor as string | undefined }));
});

export const listIncomingFollowRequests = asyncHandler(async (req: Request, res: Response) => {
  const ownerUserId = requireUserId(req);
  await requireActiveUser(ownerUserId);
  const requests = await getProfileRelationshipsCollection()
    .find({ targetUserId: ownerUserId, state: 'requested', ...cursorFilter(req.query.cursor as string | undefined) } as any)
    .sort({ _id: 1 })
    .limit(PAGE_LIMIT + 1)
    .toArray();
  const page = requests.slice(0, PAGE_LIMIT);
  const users = await getUsersCollection()
    .find(activeUserQuery({ _id: { $in: page.map((request) => request.followerUserId) } }) as any)
    .project<User>({ name: 1, profileHandle: 1, avatarUrl: 1 })
    .toArray();
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  res.status(200).json({
    requests: page.flatMap((request: ProfileRelationship) => {
      const user = byId.get(request.followerUserId.toString());
      return user ? [{ requester: serializeListUser(user), requestedAt: request.createdAt }] : [];
    }),
    nextCursor: requests.length > PAGE_LIMIT ? page[page.length - 1]._id.toString() : null,
  });
});
