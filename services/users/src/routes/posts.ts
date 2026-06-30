import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType } from '@repo/types';
import { asyncHandler, createEvent, logger, ValidationError } from '@repo/utils';
import { getDatabase } from '../db';
import { getUsersCollection } from '../models/user';
import { getProfileRelationshipsCollection } from '../models/profile-relationship';
import { hasBlockBetween } from '../models/user-block';
import { getPostsCollection, PostDocument, PostVisibility } from '../models/post';
import { getPostCommentsCollection, PostCommentDocument } from '../models/post-comment';
import { getPostReactionsCollection, POST_REACTION_EMOJIS, PostReactionEmoji } from '../models/post-reaction';
import { getPostNotificationCooldownsCollection } from '../models/post-notification-cooldown';
import { safelyDeletePostMedia } from '../post-media-cleanup';
import { getPubSub } from '../pubsub';
import { normalizeDiscoveryTopicIds } from '../discovery-topics';
import { recordDiscoverablePostEngagement } from './discovery';

const POST_TEXT_LIMIT = 2000;
const COMMENT_TEXT_LIMIT = 1000;
const MAX_MEDIA = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const POST_ACTIVITY_COOLDOWN_MS = 5 * 60 * 1000;
const REACTION_EMOJI_SET = new Set<string>(POST_REACTION_EMOJIS);

const createPostSchema = z
  .object({
    body: z.string().max(POST_TEXT_LIMIT).optional(),
    visibility: z.enum(['public', 'followers']).default('followers'),
    mediaIds: z.array(z.string().refine(ObjectId.isValid, 'Invalid media ID')).max(MAX_MEDIA).default([]),
  })
  .strict();

const updatePostSchema = z.object({ body: z.string().max(POST_TEXT_LIMIT).optional() }).strict();
const updatePostDiscoverySchema = z.object({
  discoverable: z.boolean(),
  discoveryTopicIds: z.array(z.string()).default([]),
}).strict();
const reactionSchema = z.object({ emoji: z.enum(POST_REACTION_EMOJIS) }).strict();
const commentSchema = z.object({ body: z.string().trim().min(1).max(COMMENT_TEXT_LIMIT) }).strict();

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError('Invalid post request');
  return parsed.data;
}

function requireUserId(req: Request, res: Response) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return null;
  }
  return new ObjectId(userId);
}

function activeUserQuery(extra: Record<string, unknown> = {}) {
  return { ...extra, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } };
}

function normalizeBody(value?: string) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (normalized.length > POST_TEXT_LIMIT) throw new ValidationError('Post text is too long');
  return normalized;
}

function encodeCursor(post: PostDocument) {
  return Buffer.from(JSON.stringify({ createdAt: post.createdAt.toISOString(), id: post._id.toString() })).toString('base64url');
}

function decodeCursor(cursor?: unknown) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!ObjectId.isValid(parsed.id)) return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: new ObjectId(parsed.id) };
  } catch {
    return null;
  }
}

function limitFromQuery(req: Request) {
  const parsed = Number(req.query.limit || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(parsed));
}

function publicAuthor(user: any) {
  return {
    id: user._id.toString(),
    name: user.name || user.username || 'User',
    handle: user.profileHandle || null,
    displayHandle: user.profileHandle ? `@${user.profileHandle}` : null,
    avatarUrl: user.avatarUrl || null,
  };
}

async function loadActiveUser(userId: ObjectId) {
  return getUsersCollection().findOne(activeUserQuery({ _id: userId }) as any);
}

async function getFollowingTargetIds(userId: ObjectId) {
  const relationships = await getProfileRelationshipsCollection()
    .find({ followerUserId: userId, state: 'following' })
    .project<{ targetUserId: ObjectId }>({ targetUserId: 1 })
    .toArray();
  return relationships.map((relationship) => relationship.targetUserId);
}

async function canViewerReadPostDocument(post: PostDocument, viewerUserId: ObjectId) {
  if (post.deletedAt) return false;
  const [viewer, author] = await Promise.all([loadActiveUser(viewerUserId), loadActiveUser(post.authorUserId)]);
  if (!viewer || !author) return false;
  if (await hasBlockBetween(viewerUserId, post.authorUserId)) return false;
  if (viewerUserId.equals(post.authorUserId)) return true;

  const authorVisibility = author.profileVisibility || 'private';
  if (post.visibility === 'public' && authorVisibility === 'public') return true;

  const relationship = await getProfileRelationshipsCollection().findOne({
    followerUserId: viewerUserId,
    targetUserId: post.authorUserId,
    state: 'following',
  });
  return Boolean(relationship);
}

export async function loadReadablePost(postId: ObjectId, viewerUserId: ObjectId) {
  const post = await getPostsCollection().findOne({ _id: postId, deletedAt: { $exists: false } });
  if (!post) return null;
  if (!(await canViewerReadPostDocument(post, viewerUserId))) return null;
  return post;
}

async function validatePostMedia(authorUserId: ObjectId, mediaIds: ObjectId[]) {
  if (mediaIds.length > MAX_MEDIA) throw new ValidationError('Posts can include at most 10 photos');
  const unique = Array.from(new Set(mediaIds.map((id) => id.toString())));
  if (unique.length !== mediaIds.length) throw new ValidationError('Post media must be unique');
  if (mediaIds.length === 0) return [];

  const media = await getDatabase()
    .collection('media')
    .find({
      _id: { $in: mediaIds },
      userId: authorUserId,
      status: 'approved',
      fileType: /^image\//,
    })
    .project({ _id: 1, fileType: 1, fileSize: 1 })
    .toArray();

  if (media.length !== mediaIds.length) throw new ValidationError('Post photos must be approved images owned by you');
  return media;
}

async function recomputeReactionCounts(postId: ObjectId) {
  const counts = await getPostReactionsCollection()
    .aggregate<{ _id: string; count: number }>([
      { $match: { postId } },
      { $group: { _id: '$emoji', count: { $sum: 1 } } },
    ])
    .toArray();
  const reactionCounts: Record<string, number> = {};
  for (const item of counts) {
    if (REACTION_EMOJI_SET.has(item._id) && item.count > 0) reactionCounts[item._id] = item.count;
  }
  await getPostsCollection().updateOne({ _id: postId }, { $set: { reactionCounts, updatedAt: new Date() } });
  return reactionCounts;
}

async function recomputeCommentCount(postId: ObjectId) {
  const commentCount = await getPostCommentsCollection().countDocuments({ postId, deletedAt: { $exists: false } });
  await getPostsCollection().updateOne({ _id: postId }, { $set: { commentCount, updatedAt: new Date() } });
  return commentCount;
}

async function serializePost(post: PostDocument, viewerUserId: ObjectId) {
  const [author, myReaction] = await Promise.all([
    getUsersCollection().findOne(activeUserQuery({ _id: post.authorUserId }) as any),
    getPostReactionsCollection().findOne({ postId: post._id, reactingUserId: viewerUserId }),
  ]);
  if (!author) return null;
  return {
    id: post._id.toString(),
    author: publicAuthor(author),
    body: post.body || '',
    visibility: viewerUserId.equals(post.authorUserId) ? post.visibility : undefined,
    media: post.mediaIds.map((mediaId) => ({
      mediaId: mediaId.toString(),
      type: 'image',
      url: `/api/posts/${post._id.toString()}/media/${mediaId.toString()}`,
    })),
    commentCount: post.commentCount || 0,
    reactionCounts: post.reactionCounts || {},
    myReaction: myReaction?.emoji || null,
    discovery: viewerUserId.equals(post.authorUserId)
      ? {
          discoverable: Boolean(post.discoverable),
          topicIds: Array.isArray(post.discoveryTopicIds) ? post.discoveryTopicIds : [],
          updatedAt: post.discoverableUpdatedAt || null,
        }
      : undefined,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    editedAt: post.editedAt || null,
    canEdit: viewerUserId.equals(post.authorUserId) && Date.now() - post.createdAt.getTime() <= EDIT_WINDOW_MS,
    canDelete: viewerUserId.equals(post.authorUserId),
  };
}

async function serializeComment(comment: PostCommentDocument) {
  const author = await getUsersCollection().findOne(activeUserQuery({ _id: comment.authorUserId }) as any);
  if (!author) return null;
  return {
    id: comment._id.toString(),
    author: publicAuthor(author),
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function publish(type: EventType, data: Record<string, unknown>) {
  try {
    void getPubSub().publish(createEvent(type, data) as any);
  } catch (error) {
    logger.debug({ error, type }, 'Post event publish skipped');
  }
}

async function notifyPostOwner(post: PostDocument, actorUserId: ObjectId, kind: 'reaction' | 'comment') {
  if (post.authorUserId.equals(actorUserId)) return;
  const [author, actor] = await Promise.all([loadActiveUser(post.authorUserId), loadActiveUser(actorUserId)]);
  if (!author || !actor) return;
  if (await hasBlockBetween(post.authorUserId, actorUserId)) return;

  const now = new Date();
  const cooldownSince = new Date(now.getTime() - POST_ACTIVITY_COOLDOWN_MS);
  const collection = getPostNotificationCooldownsCollection();
  const existing = await collection.findOne({
    postId: post._id,
    recipientUserId: post.authorUserId,
    actorUserId,
    kind,
  });
  if (existing?.lastSentAt && existing.lastSentAt > cooldownSince) return;

  await collection.updateOne(
    { postId: post._id, recipientUserId: post.authorUserId, actorUserId, kind },
    {
      $setOnInsert: { _id: new ObjectId(), createdAt: now },
      $set: { lastSentAt: now, updatedAt: now },
    },
    { upsert: true }
  );

  const actorName = actor.name || actor.username || 'Someone';
  const verb = kind === 'reaction' ? 'reacted' : 'commented';
  const baseUrl = (process.env.NOTIFICATIONS_SERVICE_URL || 'http://notifications:3000').replace(/\/+$/, '');
  await fetch(`${baseUrl}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: post.authorUserId.toString(),
      kind: 'post_activity',
      title: 'Post activity',
      body: `${actorName} ${verb} on your post.`,
      data: {
        postId: post._id.toString(),
        actorId: actorUserId.toString(),
        route: `/feed?post=${post._id.toString()}`,
        noPreviewBody: 'You have a new post interaction.',
      },
    }),
  }).catch((error) => {
    logger.warn({ error: error instanceof Error ? error.message : String(error), postId: post._id.toString() }, 'Post activity notification failed');
  });
}

async function listAuthorizedPosts(posts: PostDocument[], viewerUserId: ObjectId, limit: number) {
  const items = [];
  for (const post of posts) {
    if (!(await canViewerReadPostDocument(post, viewerUserId))) continue;
    const serialized = await serializePost(post, viewerUserId);
    if (serialized) items.push(serialized);
    if (items.length >= limit) break;
  }
  return items;
}

function cursorFilter(cursor: ReturnType<typeof decodeCursor>) {
  if (!cursor) return {};
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}

export const createPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = parseSchema(createPostSchema, req.body);
  const author = await loadActiveUser(userId);
  if (!author) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }

  const body = normalizeBody(parsed.body);
  const mediaIds = (parsed.mediaIds || []).map((id) => new ObjectId(id));
  if (!body && mediaIds.length === 0) throw new ValidationError('Post must include text or a photo');
  await validatePostMedia(userId, mediaIds);

  const visibility: PostVisibility = author.profileVisibility === 'public' && parsed.visibility === 'public' ? 'public' : 'followers';
  const now = new Date();
  const post: PostDocument = {
    _id: new ObjectId(),
    authorUserId: userId,
    body,
    visibility,
    mediaIds,
    commentCount: 0,
    reactionCounts: {},
    createdAt: now,
    updatedAt: now,
  };
  await getPostsCollection().insertOne(post);
  publish(EventType.POST_CREATED, { postId: post._id.toString(), authorUserId: userId.toString() });
  res.status(201).json({ post: await serializePost(post, userId) });
});

export const getPost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  res.status(200).json({ post: await serializePost(post, userId) });
});

export const updatePost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(updatePostSchema, req.body);
  const post = await getPostsCollection().findOne({ _id: new ObjectId(req.params.postId), deletedAt: { $exists: false } });
  if (!post || !post.authorUserId.equals(userId)) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  if (Date.now() - post.createdAt.getTime() > EDIT_WINDOW_MS) throw new ValidationError('Post can no longer be edited');
  const body = normalizeBody(parsed.body);
  if (!body && post.mediaIds.length === 0) throw new ValidationError('Post must include text or a photo');
  const now = new Date();
  await getPostsCollection().updateOne({ _id: post._id }, { $set: { body, editedAt: now, updatedAt: now } });
  const updated = { ...post, body, editedAt: now, updatedAt: now };
  publish(EventType.POST_UPDATED, { postId: post._id.toString(), authorUserId: userId.toString() });
  res.status(200).json({ post: await serializePost(updated, userId) });
});

function parseDiscoveryTopicIds(value: string[], min: number, max: number) {
  try {
    return normalizeDiscoveryTopicIds(value, min, max);
  } catch {
    throw new ValidationError('Invalid discovery topics');
  }
}

export const updatePostDiscovery = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(updatePostDiscoverySchema, req.body);
  const post = await getPostsCollection().findOne({ _id: new ObjectId(req.params.postId), deletedAt: { $exists: false } });
  if (!post || !post.authorUserId.equals(userId)) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const author = await loadActiveUser(userId);
  const requestedTopicIds = parsed.discoveryTopicIds || [];
  const topicIds = parsed.discoverable
    ? parseDiscoveryTopicIds(requestedTopicIds, 1, 3)
    : requestedTopicIds.length
      ? parseDiscoveryTopicIds(requestedTopicIds, 0, 3)
      : [];
  if (parsed.discoverable) {
    if (!author || !(author as any).emailVerified || author.profileVisibility !== 'public' || !author.profileHandle || !author.creatorDiscoveryEnabled) {
      throw new ValidationError('This post is not eligible for Discover');
    }
    if (post.visibility !== 'public') throw new ValidationError('Only public posts can be included in Discover');
    await validatePostMedia(userId, post.mediaIds);
  }
  const now = new Date();
  await getPostsCollection().updateOne(
    { _id: post._id },
    { $set: { discoverable: parsed.discoverable, discoveryTopicIds: topicIds, discoverableUpdatedAt: now, updatedAt: now } }
  );
  const updated = await getPostsCollection().findOne({ _id: post._id });
  publish(EventType.POST_UPDATED, { postId: post._id.toString(), authorUserId: userId.toString() });
  res.status(200).json({ post: await serializePost(updated!, userId) });
});

export const deletePost = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await getPostsCollection().findOne({ _id: new ObjectId(req.params.postId), deletedAt: { $exists: false } });
  if (!post || !post.authorUserId.equals(userId)) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const now = new Date();
  await getPostsCollection().updateOne({ _id: post._id }, { $set: { deletedAt: now, updatedAt: now } });
  await Promise.all([
    getPostCommentsCollection().deleteMany({ postId: post._id }),
    getPostReactionsCollection().deleteMany({ postId: post._id }),
    getPostNotificationCooldownsCollection().deleteMany({ postId: post._id }),
  ]);
  await Promise.all(post.mediaIds.map((mediaId) => safelyDeletePostMedia(mediaId, post._id)));
  publish(EventType.POST_DELETED, { postId: post._id.toString(), authorUserId: userId.toString() });
  res.status(200).json({ success: true });
});

export const listFeed = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!(await loadActiveUser(userId))) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }
  const limit = limitFromQuery(req);
  const authorIds = [userId, ...(await getFollowingTargetIds(userId))];
  const cursor = decodeCursor(req.query.cursor);
  const candidates = await getPostsCollection()
    .find({ authorUserId: { $in: authorIds }, deletedAt: { $exists: false }, ...cursorFilter(cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit * 3 + 1)
    .toArray();
  const posts = await listAuthorizedPosts(candidates, userId, limit);
  const last = candidates[Math.min(candidates.length, limit) - 1];
  res.status(200).json({ posts, nextCursor: candidates.length > limit && last ? encodeCursor(last) : null });
});

export const listProfilePosts = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const target = await getUsersCollection().findOne(activeUserQuery({ profileHandle: String(req.params.handle || '').toLowerCase() }) as any);
  if (!target || (await hasBlockBetween(userId, target._id))) {
    res.status(404).json({ error: 'Not Found', message: 'Profile not found' });
    return;
  }
  const limit = limitFromQuery(req);
  const cursor = decodeCursor(req.query.cursor);
  const candidates = await getPostsCollection()
    .find({ authorUserId: target._id, deletedAt: { $exists: false }, ...cursorFilter(cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit * 3 + 1)
    .toArray();
  const posts = await listAuthorizedPosts(candidates, userId, limit);
  const last = candidates[Math.min(candidates.length, limit) - 1];
  res.status(200).json({ posts, nextCursor: candidates.length > limit && last ? encodeCursor(last) : null });
});

export const getPostMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId) || !ObjectId.isValid(req.params.mediaId)) throw new ValidationError('Invalid media request');
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
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
    headers: process.env.MOMENT_INTERNAL_MEDIA_TOKEN
      ? { 'x-moment-internal-token': process.env.MOMENT_INTERNAL_MEDIA_TOKEN }
      : undefined,
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

export const setPostReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(reactionSchema, req.body);
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const now = new Date();
  await getPostReactionsCollection().updateOne(
    { postId: post._id, reactingUserId: userId },
    {
      $setOnInsert: { _id: new ObjectId(), postId: post._id, authorUserId: post.authorUserId, reactingUserId: userId, createdAt: now },
      $set: { emoji: parsed.emoji as PostReactionEmoji, updatedAt: now },
    },
    { upsert: true }
  );
  const reactionCounts = await recomputeReactionCounts(post._id);
  await notifyPostOwner(post, userId, 'reaction');
  publish(EventType.POST_INTERACTION_UPDATED, { postId: post._id.toString(), authorUserId: post.authorUserId.toString() });
  void recordDiscoverablePostEngagement(userId, post, 'reaction').catch(() => undefined);
  res.status(200).json({ reactionCounts, myReaction: parsed.emoji });
});

export const removePostReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  await getPostReactionsCollection().deleteOne({ postId: post._id, reactingUserId: userId });
  const reactionCounts = await recomputeReactionCounts(post._id);
  publish(EventType.POST_INTERACTION_UPDATED, { postId: post._id.toString(), authorUserId: post.authorUserId.toString() });
  res.status(200).json({ reactionCounts, myReaction: null });
});

export const listPostComments = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const cursor = decodeCursor(req.query.cursor);
  const filter: any = { postId: post._id, deletedAt: { $exists: false } };
  if (cursor) {
    filter.$or = [
      { createdAt: { $gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $gt: cursor.id } },
    ];
  }
  const limit = limitFromQuery(req);
  const comments = await getPostCommentsCollection().find(filter).sort({ createdAt: 1, _id: 1 }).limit(limit + 1).toArray();
  const page = comments.slice(0, limit);
  const serialized = (await Promise.all(page.map(serializeComment))).filter(Boolean);
  const last = page[page.length - 1];
  res.status(200).json({ comments: serialized, nextCursor: comments.length > limit && last ? encodeCursor(last as any) : null });
});

export const createPostComment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId)) throw new ValidationError('Invalid post ID');
  const parsed = parseSchema(commentSchema, req.body);
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const now = new Date();
  const comment: PostCommentDocument = {
    _id: new ObjectId(),
    postId: post._id,
    postAuthorUserId: post.authorUserId,
    authorUserId: userId,
    body: parsed.body,
    createdAt: now,
  };
  await getPostCommentsCollection().insertOne(comment);
  const commentCount = await recomputeCommentCount(post._id);
  await notifyPostOwner(post, userId, 'comment');
  publish(EventType.POST_COMMENTS_UPDATED, { postId: post._id.toString(), authorUserId: post.authorUserId.toString() });
  void recordDiscoverablePostEngagement(userId, post, 'comment').catch(() => undefined);
  res.status(201).json({ comment: await serializeComment(comment), commentCount });
});

export const deletePostComment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.postId) || !ObjectId.isValid(req.params.commentId)) throw new ValidationError('Invalid comment request');
  const post = await loadReadablePost(new ObjectId(req.params.postId), userId);
  if (!post) {
    res.status(404).json({ error: 'Not Found', message: 'Post not found' });
    return;
  }
  const comment = await getPostCommentsCollection().findOne({ _id: new ObjectId(req.params.commentId), postId: post._id, deletedAt: { $exists: false } });
  if (!comment || (!comment.authorUserId.equals(userId) && !post.authorUserId.equals(userId))) {
    res.status(404).json({ error: 'Not Found', message: 'Comment not found' });
    return;
  }
  await getPostCommentsCollection().updateOne(
    { _id: comment._id },
    { $set: { deletedAt: new Date(), deletedByUserId: userId }, $unset: { body: '' } }
  );
  const commentCount = await recomputeCommentCount(post._id);
  publish(EventType.POST_COMMENTS_UPDATED, { postId: post._id.toString(), authorUserId: post.authorUserId.toString() });
  res.status(200).json({ success: true, commentCount });
});
