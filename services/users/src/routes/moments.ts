import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType, MessageSentEvent, MomentInteractionsUpdatedEvent, MomentReactionUpdatedEvent } from '@repo/types';
import { asyncHandler, createEvent, logger, ValidationError } from '@repo/utils';
import { getDatabase } from '../db';
import { getMomentsCollection, MomentAudienceType, MomentDocument } from '../models/moment';
import { getMomentViewsCollection } from '../models/moment-view';
import { getMomentReactionsCollection, MOMENT_REACTION_EMOJIS, MomentReactionEmoji } from '../models/moment-reaction';
import { getMomentNotificationCooldownsCollection, MomentNotificationKind } from '../models/moment-notification-cooldown';
import { getMomentVideoPlaybackSessionsCollection } from '../models/moment-video-playback-session';
import { getCloseFriendsCollection } from '../models/close-friend';
import { getOrCreateUserSettings } from '../models/user-settings';
import { hasBlockBetween } from '../models/user-block';
import { MomentExpiryProcessor } from '../workers/moment-expiry-processor';
import { safelyDeleteMomentMedia } from '../moment-media-cleanup';
import { deleteMomentVideoArtifacts } from '../moment-video-cleanup';
import { getPubSub } from '../pubsub';

const TEXT_LIMIT = 500;
const REPLY_TEXT_LIMIT = 1000;
const MOMENT_UPDATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MOMENT_ACTIVITY_COOLDOWN_MS = 5 * 60 * 1000;
const MOMENT_VIDEO_PLAYBACK_SESSION_TTL_MS = 5 * 60 * 1000;
const MEDIA_ROOT = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
const STYLE_KEYS = new Set(['teal', 'sky', 'violet', 'rose', 'amber', 'slate']);
const TEXT_STYLE_KEYS = new Set(['classic', 'headline', 'quiet']);
const REACTION_EMOJI_SET = new Set<string>(MOMENT_REACTION_EMOJIS);

const CreateMomentSchema = z.object({
  type: z.enum(['text', 'image', 'audio', 'video']),
  textBody: z.string().trim().max(TEXT_LIMIT).optional(),
  caption: z.string().trim().max(TEXT_LIMIT).optional(),
  mediaId: z.string().trim().optional(),
  videoId: z.string().trim().optional(),
  style: z
    .object({
      backgroundKey: z.string().trim().optional(),
      textStyleKey: z.string().trim().optional(),
    })
    .optional(),
  audienceType: z.enum(['contacts', 'contacts_except', 'only_share_with', 'close_friends']).default('contacts'),
  selectedUserIds: z.array(z.string()).default([]),
});

const UpdateCloseFriendSchema = z.object({ userId: z.string().trim() });
const MomentReactionSchema = z.object({ emoji: z.enum(MOMENT_REACTION_EMOJIS) });
const MomentReplySchema = z.object({ body: z.string().trim().min(1).max(REPLY_TEXT_LIMIT) }).strict();

function requireUserId(req: Request, res: Response) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return null;
  }
  return new ObjectId(userId);
}

function publicUser(user: any) {
  return {
    _id: user?._id?.toString?.() || String(user?._id || ''),
    name: user?.name || user?.username || 'User',
    avatarUrl: user?.avatarUrl || null,
  };
}

function isSafeLocalMediaPath(path: string) {
  const root = resolve(MEDIA_ROOT);
  const target = resolve(path);
  return target === root || target.startsWith(`${root}/`);
}

async function ensureActiveUser(userId: ObjectId) {
  const user = await getDatabase().collection('users').findOne({
    _id: userId,
    deletedAt: { $exists: false },
    deactivatedAt: { $exists: false },
  });
  if (!user) throw new ValidationError('Moment is unavailable');
  return user;
}

async function eligibleContacts(ownerUserId: ObjectId) {
  const owner = ownerUserId.toString();
  const directChats = await getDatabase()
    .collection('chats')
    .find({
      type: 'direct',
      participants: ownerUserId,
      deletedAt: { $exists: false },
      endedAt: { $exists: false },
    })
    .project({ participants: 1 })
    .toArray();

  const ids = new Set<string>();
  for (const chat of directChats) {
    for (const participant of chat.participants || []) {
      const value = String(participant);
      if (value !== owner && ObjectId.isValid(value)) ids.add(value);
    }
  }
  if (!ids.size) return [];

  const objectIds = [...ids].map((id) => new ObjectId(id));
  const blocks = await getDatabase()
    .collection('user_blocks')
    .find({
      $or: [
        { blockerUserId: ownerUserId, blockedUserId: { $in: objectIds } },
        { blockedUserId: ownerUserId, blockerUserId: { $in: objectIds } },
      ],
    })
    .toArray();
  for (const block of blocks) {
    ids.delete(String(block.blockerUserId));
    ids.delete(String(block.blockedUserId));
  }

  return getDatabase()
    .collection('users')
    .find({
      _id: { $in: objectIds.filter((id) => ids.has(id.toString())) },
      deletedAt: { $exists: false },
      deactivatedAt: { $exists: false },
    })
    .project({ name: 1, username: 1, avatarUrl: 1 })
    .sort({ name: 1, username: 1 })
    .toArray();
}

async function audienceSnapshot(ownerUserId: ObjectId, audienceType: MomentAudienceType, selectedUserIds: string[]) {
  const contacts = await eligibleContacts(ownerUserId);
  const contactIds = new Set(contacts.map((user) => user._id.toString()));
  const selected = [...new Set(selectedUserIds)].filter(ObjectId.isValid);

  if (selected.some((id) => !contactIds.has(id))) throw new ValidationError('Moment audience is unavailable');

  if (audienceType === 'contacts') return contacts.map((user) => user._id);
  if (audienceType === 'contacts_except') {
    const excluded = new Set(selected);
    return contacts.map((user) => user._id).filter((id) => !excluded.has(id.toString()));
  }
  if (audienceType === 'only_share_with') return selected.map((id) => new ObjectId(id));

  const closeFriends = await getCloseFriendsCollection()
    .find({ ownerUserId, friendUserId: { $in: contacts.map((user) => user._id) } })
    .toArray();
  return closeFriends.map((friend) => friend.friendUserId).filter((id) => contactIds.has(id.toString()));
}

function serializeMoment(
  moment: MomentDocument,
  author: any,
  viewed: boolean,
  includeAuthorFields = false,
  myReaction?: MomentReactionEmoji | null
) {
  return {
    _id: moment._id.toString(),
    author: publicUser(author),
    type: moment.type,
    textBody: moment.textBody || '',
    caption: moment.caption || '',
    mediaUrl: moment.mediaId && ['image', 'audio'].includes(moment.type) ? `/api/moments/${moment._id.toString()}/media` : null,
    videoPlaybackUrl: moment.videoId && moment.type === 'video' ? `/api/moments/${moment._id.toString()}/video/playback-session` : null,
    style: moment.style || { backgroundKey: 'teal', textStyleKey: 'classic' },
    createdAt: moment.createdAt,
    expiresAt: moment.expiresAt,
    archiveState: moment.archiveState,
    viewed,
    ...(myReaction ? { myReaction } : {}),
    ...(includeAuthorFields ? { audienceType: moment.audienceType } : {}),
  };
}

async function visibleActiveMoment(moment: MomentDocument, viewerUserId: ObjectId) {
  if (moment.archiveState !== 'active' || moment.expiresAt <= new Date() || moment.deletedAt) return false;
  if (moment.authorUserId.equals(viewerUserId)) return true;
  if (!moment.audienceSnapshotUserIds.some((id) => id.equals(viewerUserId))) return false;
  return !(await hasBlockBetween(moment.authorUserId, viewerUserId));
}

async function loadAuthorizedMoment(momentId: string, viewerUserId: ObjectId, allowArchiveOwner = false) {
  if (!ObjectId.isValid(momentId)) return null;
  const moment = await getMomentsCollection().findOne({ _id: new ObjectId(momentId), archiveState: { $ne: 'deleted' } });
  if (!moment) return null;
  if (allowArchiveOwner && moment.authorUserId.equals(viewerUserId)) return moment;
  return (await visibleActiveMoment(moment, viewerUserId)) ? moment : null;
}

function momentUnavailable(res: Response) {
  res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
}

function momentReplyUnavailable(res: Response) {
  res.status(404).json({ error: 'Not Found', message: 'This reply is unavailable.' });
}

async function loadActiveViewerMoment(momentId: string, viewerUserId: ObjectId) {
  const moment = await loadAuthorizedMoment(momentId, viewerUserId);
  if (!moment || moment.authorUserId.equals(viewerUserId)) return null;
  await ensureActiveUser(moment.authorUserId);
  await ensureActiveUser(viewerUserId);
  return moment;
}

async function reactionMapForViewer(momentIds: ObjectId[], viewerUserId: ObjectId) {
  if (momentIds.length === 0) return new Map<string, MomentReactionEmoji>();
  const reactions = await getMomentReactionsCollection()
    .find({ momentId: { $in: momentIds }, viewerUserId })
    .project<{ momentId: ObjectId; emoji: MomentReactionEmoji }>({ momentId: 1, emoji: 1 })
    .toArray();
  return new Map(reactions.map((reaction) => [reaction.momentId.toString(), reaction.emoji]));
}

async function publishMomentReaction(moment: MomentDocument, viewerUserId: ObjectId, emoji: MomentReactionEmoji | null, operation: 'set' | 'remove') {
  try {
    await getPubSub().publish(createEvent<MomentReactionUpdatedEvent>(EventType.MOMENT_REACTION_UPDATED, {
      momentId: moment._id.toString(),
      viewerUserId: viewerUserId.toString(),
      authorUserId: moment.authorUserId.toString(),
      emoji,
      operation,
    }));
    await getPubSub().publish(createEvent<MomentInteractionsUpdatedEvent>(EventType.MOMENT_INTERACTIONS_UPDATED, {
      momentId: moment._id.toString(),
      authorUserId: moment.authorUserId.toString(),
    }));
  } catch (error) {
    logger.error({ error, momentId: moment._id.toString() }, 'Failed to publish Moment reaction event');
  }
}

async function cooldownAllows(kind: MomentNotificationKind, filter: Record<string, unknown>, cooldownMs: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - cooldownMs);
  const collection = getMomentNotificationCooldownsCollection();
  const existing = await collection.findOne({ kind, ...filter });
  if (existing?.lastSentAt && existing.lastSentAt > cutoff) return false;
  if (existing) {
    await collection.updateOne({ _id: existing._id }, { $set: { lastSentAt: now, updatedAt: now } });
    return true;
  }
  await collection.insertOne({
    _id: new ObjectId(),
    kind,
    ...filter,
    lastSentAt: now,
    createdAt: now,
    updatedAt: now,
  } as any);
  return true;
}

async function sendMomentNotification(payload: {
  userId: string;
  kind: 'moment_update' | 'moment_activity';
  title: string;
  body: string;
  data: Record<string, unknown>;
}) {
  const baseUrl = (process.env.NOTIFICATIONS_SERVICE_URL || process.env.NOTIFICATION_SERVICE_URL || 'http://notifications:3000').replace(/\/+$/, '');
  try {
    await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.error({ error, kind: payload.kind, userId: payload.userId }, 'Failed to send Moment notification');
  }
}

async function sendMomentUpdateNotifications(moment: MomentDocument, author: any) {
  await Promise.all(moment.audienceSnapshotUserIds.map(async (recipientUserId) => {
    if (recipientUserId.equals(moment.authorUserId)) return;
    if (await hasBlockBetween(moment.authorUserId, recipientUserId)) return;
    try {
      await ensureActiveUser(recipientUserId);
    } catch {
      return;
    }
    const allowed = await cooldownAllows('moment_update', {
      authorUserId: moment.authorUserId,
      recipientUserId,
    }, MOMENT_UPDATE_COOLDOWN_MS);
    if (!allowed) return;
    await sendMomentNotification({
      userId: recipientUserId.toString(),
      kind: 'moment_update',
      title: 'New Moment',
      body: `${author?.name || author?.username || 'Someone'} shared a Moment.`,
      data: {
        route: '/moments',
        momentId: moment._id.toString(),
        authorUserId: moment.authorUserId.toString(),
        noPreviewBody: 'Someone shared a Moment.',
      },
    });
  }));
}

async function sendMomentActivityNotification(moment: MomentDocument, viewerUserId: ObjectId) {
  const allowed = await cooldownAllows('moment_activity', {
    momentId: moment._id,
    authorUserId: moment.authorUserId,
    recipientUserId: moment.authorUserId,
    viewerUserId,
  }, MOMENT_ACTIVITY_COOLDOWN_MS);
  if (!allowed) return;
  await sendMomentNotification({
    userId: moment.authorUserId.toString(),
    kind: 'moment_activity',
    title: 'Moment activity',
    body: 'Someone reacted to your Moment.',
    data: {
      route: '/moments',
      momentId: moment._id.toString(),
      noPreviewBody: 'Someone reacted to your Moment.',
    },
  });
}

async function findEligibleDirectChat(viewerUserId: ObjectId, authorUserId: ObjectId) {
  const chat = await getDatabase().collection('chats').findOne({
    type: 'direct',
    participants: { $all: [viewerUserId, authorUserId] },
    deletedAt: { $exists: false },
    endedAt: { $exists: false },
  });
  if (!chat?.participants?.some((id: ObjectId) => id.equals(viewerUserId)) || !chat.participants.some((id: ObjectId) => id.equals(authorUserId))) {
    return null;
  }
  if (await hasBlockBetween(viewerUserId, authorUserId)) return null;
  return chat;
}

function serializeMomentReplyMessage(message: any) {
  return {
    _id: message._id.toString(),
    chatId: message.chatId.toString(),
    senderId: message.senderId.toString(),
    type: 'text',
    body: message.body,
    momentReply: { isMomentReply: true, label: 'Replied to a Moment' },
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: message.createdAt,
  };
}

export const listMomentContacts = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  await ensureActiveUser(userId);
  const contacts = await eligibleContacts(userId);
  res.status(200).json({ contacts: contacts.map(publicUser) });
});

export const listCloseFriends = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const docs = await getCloseFriendsCollection().find({ ownerUserId: userId }).toArray();
  const users = await getDatabase()
    .collection('users')
    .find({ _id: { $in: docs.map((doc) => doc.friendUserId) } })
    .project({ name: 1, username: 1, avatarUrl: 1 })
    .toArray();
  res.status(200).json({ closeFriends: users.map(publicUser) });
});

export const addCloseFriend = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const body = UpdateCloseFriendSchema.parse(req.body);
  if (!ObjectId.isValid(body.userId) || body.userId === userId.toString()) throw new ValidationError('Close Friends selection is unavailable');
  const contacts = await eligibleContacts(userId);
  if (!contacts.some((user) => user._id.toString() === body.userId)) throw new ValidationError('Close Friends selection is unavailable');
  await getCloseFriendsCollection().updateOne(
    { ownerUserId: userId, friendUserId: new ObjectId(body.userId) },
    { $setOnInsert: { _id: new ObjectId(), ownerUserId: userId, friendUserId: new ObjectId(body.userId), createdAt: new Date() } },
    { upsert: true }
  );
  res.status(200).json({ success: true });
});

export const removeCloseFriend = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.userId)) throw new ValidationError('Close Friends selection is unavailable');
  await getCloseFriendsCollection().deleteOne({ ownerUserId: userId, friendUserId: new ObjectId(req.params.userId) });
  res.status(200).json({ success: true });
});

export const createMoment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  await ensureActiveUser(userId);

  const body = CreateMomentSchema.parse(req.body);
  if (body.style?.backgroundKey && !STYLE_KEYS.has(body.style.backgroundKey)) throw new ValidationError('Moment style is unavailable');
  if (body.style?.textStyleKey && !TEXT_STYLE_KEYS.has(body.style.textStyleKey)) throw new ValidationError('Moment style is unavailable');

  const now = new Date();
  const momentId = new ObjectId();
  let mediaId: ObjectId | undefined;
  let videoId: ObjectId | undefined;
  if (body.type === 'text') {
    if (!body.textBody) throw new ValidationError('Moment text is required');
  } else if (body.type === 'image' || body.type === 'audio') {
    if (!body.mediaId || !ObjectId.isValid(body.mediaId)) throw new ValidationError(body.type === 'audio' ? 'Moment audio is required' : 'Moment photo is required');
    const media = await getDatabase().collection('media').findOne({
      _id: new ObjectId(body.mediaId),
      userId,
      status: 'approved',
      fileType: body.type === 'audio' ? /^audio\// : /^image\//,
    });
    if (!media) throw new ValidationError(body.type === 'audio' ? 'Moment audio is unavailable' : 'Moment photo is unavailable');
    mediaId = media._id;
  } else if (body.type === 'video') {
    if (!body.videoId || !ObjectId.isValid(body.videoId)) throw new ValidationError('Moment video is required');
    videoId = new ObjectId(body.videoId);
    const video = await getDatabase().collection('moment_videos').findOneAndUpdate(
      {
        _id: videoId,
        authorUserId: userId,
        processingStatus: 'ready',
        momentId: { $exists: false },
        deletedAt: { $exists: false },
      },
      { $set: { momentId, publishedAt: now, updatedAt: now } },
      { returnDocument: 'after' }
    );
    if (!video?.sourceMediaId || !video.fallbackPath || !video.posterPath) throw new ValidationError('Moment video is unavailable');
    const media = await getDatabase().collection('media').findOne({
      _id: video.sourceMediaId,
      userId,
      status: 'approved',
      purpose: 'moment_video_source',
      fileType: 'video/mp4',
      deletedAt: { $exists: false },
    });
    if (!media) throw new ValidationError('Moment video is unavailable');
    mediaId = video.sourceMediaId;
  }

  const moment: MomentDocument = {
    _id: momentId,
    authorUserId: userId,
    type: body.type,
    textBody: body.type === 'text' ? body.textBody : undefined,
    caption: body.caption || undefined,
    mediaId,
    videoId,
    style: {
      backgroundKey: body.style?.backgroundKey || 'teal',
      textStyleKey: body.style?.textStyleKey || 'classic',
    },
    audienceType: body.audienceType,
    audienceSnapshotUserIds: await audienceSnapshot(userId, body.audienceType, body.selectedUserIds),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    archiveState: 'active',
  };

  await getMomentsCollection().insertOne(moment);
  const author = await ensureActiveUser(userId);
  void sendMomentUpdateNotifications(moment, author).catch((error) => {
    logger.error({ error, momentId: moment._id.toString() }, 'Failed to process Moment update notifications');
  });
  res.status(201).json({ moment: serializeMoment(moment, author, false, true) });
});

export const getMomentsFeed = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  await ensureActiveUser(userId);
  const moments = await getMomentsCollection()
    .find({
      archiveState: 'active',
      expiresAt: { $gt: new Date() },
      $or: [{ authorUserId: userId }, { audienceSnapshotUserIds: userId }],
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  const visible = [];
  for (const moment of moments) if (await visibleActiveMoment(moment, userId)) visible.push(moment);
  const authors = await getDatabase()
    .collection('users')
    .find({ _id: { $in: [...new Set(visible.map((moment) => moment.authorUserId.toString()))].map((id) => new ObjectId(id)) } })
    .project({ name: 1, username: 1, avatarUrl: 1 })
    .toArray();
  const authorById = new Map(authors.map((author) => [author._id.toString(), author]));
  const views = await getMomentViewsCollection()
    .find({ viewerUserId: userId, momentId: { $in: visible.map((moment) => moment._id) } })
    .toArray();
  const viewedIds = new Set(views.map((view) => view.momentId.toString()));
  const reactionsByMomentId = await reactionMapForViewer(
    visible.filter((moment) => !moment.authorUserId.equals(userId)).map((moment) => moment._id),
    userId
  );
  const serialized = visible.map((moment) => serializeMoment(
    moment,
    authorById.get(moment.authorUserId.toString()),
    viewedIds.has(moment._id.toString()),
    moment.authorUserId.equals(userId),
    moment.authorUserId.equals(userId) ? null : reactionsByMomentId.get(moment._id.toString()) || null
  ));
  res.status(200).json({
    myMoments: serialized.filter((moment) => moment.author._id === userId.toString()),
    recentMoments: serialized.filter((moment) => moment.author._id !== userId.toString() && !moment.viewed),
    viewedMoments: serialized.filter((moment) => moment.author._id !== userId.toString() && moment.viewed),
  });
});

export const getMoment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const moment = await loadAuthorizedMoment(req.params.id, userId, true);
  if (!moment) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  const author = await ensureActiveUser(moment.authorUserId);
  const view = await getMomentViewsCollection().findOne({ momentId: moment._id, viewerUserId: userId });
  const reaction = moment.authorUserId.equals(userId)
    ? null
    : await getMomentReactionsCollection().findOne({ momentId: moment._id, viewerUserId: userId });
  res.status(200).json({
    moment: serializeMoment(
      moment,
      author,
      Boolean(view),
      moment.authorUserId.equals(userId),
      reaction?.emoji || null
    ),
  });
});

export const markMomentViewed = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const moment = await loadAuthorizedMoment(req.params.id, userId);
  if (!moment || moment.authorUserId.equals(userId)) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  const now = new Date();
  await getMomentViewsCollection().updateOne(
    { momentId: moment._id, viewerUserId: userId },
    { $setOnInsert: { _id: new ObjectId(), momentId: moment._id, viewerUserId: userId, viewedAt: now } },
    { upsert: true }
  );
  res.status(200).json({ viewed: true });
});

export const listMomentViewers = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.id)) throw new ValidationError('Invalid Moment ID');
  const moment = await getMomentsCollection().findOne({ _id: new ObjectId(req.params.id), authorUserId: userId, archiveState: { $ne: 'deleted' } });
  if (!moment) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  const views = await getMomentViewsCollection().find({ momentId: moment._id }).sort({ viewedAt: -1 }).toArray();
  const users = await getDatabase()
    .collection('users')
    .find({ _id: { $in: views.map((view) => view.viewerUserId) } })
    .project({ name: 1, username: 1, avatarUrl: 1 })
    .toArray();
  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  res.status(200).json({
    viewers: views.map((view) => ({ viewer: publicUser(userById.get(view.viewerUserId.toString())), viewedAt: view.viewedAt })),
  });
});

export const reactToMoment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const body = MomentReactionSchema.parse(req.body);
  if (!REACTION_EMOJI_SET.has(body.emoji)) throw new ValidationError('Moment reaction is unavailable');
  const moment = await loadActiveViewerMoment(req.params.id, userId);
  if (!moment) {
    momentUnavailable(res);
    return;
  }

  const now = new Date();
  await getMomentReactionsCollection().updateOne(
    { momentId: moment._id, viewerUserId: userId },
    {
      $set: {
        emoji: body.emoji,
        authorUserId: moment.authorUserId,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId(),
        momentId: moment._id,
        viewerUserId: userId,
        createdAt: now,
      },
    },
    { upsert: true }
  );
  await publishMomentReaction(moment, userId, body.emoji, 'set');
  void sendMomentActivityNotification(moment, userId).catch((error) => {
    logger.error({ error, momentId: moment._id.toString() }, 'Failed to process Moment activity notification');
  });
  res.status(200).json({ reaction: { emoji: body.emoji, updatedAt: now } });
});

export const removeMomentReaction = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const moment = await loadActiveViewerMoment(req.params.id, userId);
  if (!moment) {
    momentUnavailable(res);
    return;
  }
  await getMomentReactionsCollection().deleteOne({ momentId: moment._id, viewerUserId: userId });
  await publishMomentReaction(moment, userId, null, 'remove');
  res.status(200).json({ reaction: null });
});

export const listMomentInteractions = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.id)) throw new ValidationError('Invalid Moment ID');
  const moment = await getMomentsCollection().findOne({
    _id: new ObjectId(req.params.id),
    authorUserId: userId,
    archiveState: { $ne: 'deleted' },
  });
  if (!moment) {
    momentUnavailable(res);
    return;
  }

  const [views, reactions] = await Promise.all([
    getMomentViewsCollection().find({ momentId: moment._id }).sort({ viewedAt: -1 }).toArray(),
    getMomentReactionsCollection().find({ momentId: moment._id }).sort({ updatedAt: -1 }).toArray(),
  ]);
  const viewerIds = Array.from(new Set([
    ...views.map((view) => view.viewerUserId.toString()),
    ...reactions.map((reaction) => reaction.viewerUserId.toString()),
  ])).map((id) => new ObjectId(id));
  const users = await getDatabase()
    .collection('users')
    .find({ _id: { $in: viewerIds } })
    .project({ name: 1, username: 1, avatarUrl: 1 })
    .toArray();
  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const viewByViewerId = new Map(views.map((view) => [view.viewerUserId.toString(), view]));
  const reactionByViewerId = new Map(reactions.map((reaction) => [reaction.viewerUserId.toString(), reaction]));

  res.status(200).json({
    interactions: viewerIds.map((viewerId) => {
      const id = viewerId.toString();
      const reaction = reactionByViewerId.get(id);
      return {
        viewer: publicUser(userById.get(id)),
        viewedAt: viewByViewerId.get(id)?.viewedAt || null,
        reaction: reaction ? { emoji: reaction.emoji, reactedAt: reaction.updatedAt } : null,
      };
    }),
  });
});

export const replyToMoment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const body = MomentReplySchema.parse(req.body);
  const moment = await loadActiveViewerMoment(req.params.id, userId);
  if (!moment) {
    momentReplyUnavailable(res);
    return;
  }
  const chat = await findEligibleDirectChat(userId, moment.authorUserId);
  if (!chat) {
    momentReplyUnavailable(res);
    return;
  }

  const now = new Date();
  const messageDoc = {
    _id: new ObjectId(),
    chatId: chat._id,
    senderId: userId,
    type: 'text',
    body: body.body,
    momentReply: {
      isMomentReply: true,
      momentId: moment._id,
      authorUserId: moment.authorUserId,
      label: 'Replied to a Moment',
      createdAt: now,
    },
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: now,
  };

  await getDatabase().collection('messages').insertOne(messageDoc);
  await getDatabase().collection('userChatPreferences').updateMany(
    { chatId: chat._id, userId: { $in: chat.participants }, archived: true },
    { $set: { archived: false, updatedAt: now }, $unset: { archivedAt: '' } }
  );
  await getDatabase().collection('chats').updateOne(
    { _id: chat._id },
    {
      $set: {
        lastMessageRef: {
          messageId: messageDoc._id,
          body: messageDoc.body,
          senderId: messageDoc.senderId,
          createdAt: messageDoc.createdAt,
        },
        updatedAt: now,
      },
    }
  );

  const sender = await getDatabase().collection('users').findOne(
    { _id: userId },
    { projection: { name: 1, username: 1 } }
  );
  const apiMessage = serializeMomentReplyMessage(messageDoc);
  try {
    await getPubSub().publish(createEvent<MessageSentEvent>(EventType.MESSAGE_SENT, {
      messageId: messageDoc._id.toString(),
      chatId: chat._id.toString(),
      senderId: userId.toString(),
      senderName: sender?.name || sender?.username || 'Someone',
      content: messageDoc.body,
      chatType: 'direct',
      participants: chat.participants.map((participantId: ObjectId) => participantId.toString()),
      message: apiMessage,
      createdAt: now.toISOString(),
    }));
  } catch (error) {
    logger.error({ error, messageId: messageDoc._id.toString() }, 'Failed to publish Moment reply message');
  }

  res.status(201).json({ message: apiMessage });
});

export const listMomentArchive = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const moments = await getMomentsCollection().find({ authorUserId: userId, archiveState: 'archived' }).sort({ createdAt: -1 }).limit(100).toArray();
  const author = await ensureActiveUser(userId);
  res.status(200).json({ moments: moments.map((moment) => serializeMoment(moment, author, false, true)) });
});

export const updateMomentArchiveSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const enabled = z.object({ momentArchiveEnabled: z.boolean() }).parse(req.body).momentArchiveEnabled;
  const settings = await getOrCreateUserSettings(userId);
  await getDatabase().collection('userSettings').updateOne({ userId }, { $set: { momentArchiveEnabled: enabled, updatedAt: new Date() } });
  res.status(200).json({ settings: { ...settings, momentArchiveEnabled: enabled } });
});

export const deleteMoment = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.id)) throw new ValidationError('Invalid Moment ID');
  const moment = await getMomentsCollection().findOne({ _id: new ObjectId(req.params.id), authorUserId: userId, archiveState: { $ne: 'deleted' } });
  if (!moment) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  await getMomentsCollection().updateOne({ _id: moment._id }, { $set: { archiveState: 'deleted', deletedAt: new Date() } });
  await getMomentViewsCollection().deleteMany({ momentId: moment._id });
  await getMomentReactionsCollection().deleteMany({ momentId: moment._id });
  await getMomentNotificationCooldownsCollection().deleteMany({ momentId: moment._id });
  await getDatabase().collection('messages').updateMany(
    { 'momentReply.momentId': moment._id },
    { $unset: { momentReply: '' } }
  );
  if (moment.videoId) await deleteMomentVideoArtifacts(moment.videoId);
  if (moment.mediaId) await safelyDeleteMomentMedia(moment.mediaId, moment._id);
  res.status(200).json({ success: true });
});

export const getMomentMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const moment = await loadAuthorizedMoment(req.params.id, userId, true);
  if (!moment?.mediaId || !['image', 'audio'].includes(moment.type)) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  const media = await getDatabase().collection('media').findOne({
    _id: moment.mediaId,
    status: 'approved',
    fileType: moment.type === 'audio' ? /^audio\// : /^image\//,
  });
  if (!media) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  const baseUrl = (process.env.MEDIA_SERVICE_URL || 'http://media:3000').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/local/${moment.mediaId.toString()}`, {
    headers: process.env.MOMENT_INTERNAL_MEDIA_TOKEN
      ? { 'x-moment-internal-token': process.env.MOMENT_INTERNAL_MEDIA_TOKEN }
      : undefined,
  });
  if (!response.ok || !response.body) {
    res.status(404).json({ error: 'Not Found', message: 'This Moment is no longer available.' });
    return;
  }
  res.setHeader('Content-Type', response.headers.get('content-type') || media.fileType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  const buffer = Buffer.from(await response.arrayBuffer());
  res.status(200).send(buffer);
});

async function loadAuthorizedVideoMoment(momentId: string, viewerUserId: ObjectId) {
  const moment = await loadAuthorizedMoment(momentId, viewerUserId, true);
  if (!moment?.videoId || moment.type !== 'video') return null;
  await ensureActiveUser(viewerUserId);
  await ensureActiveUser(moment.authorUserId);

  const video = await getDatabase().collection('moment_videos').findOne({
    _id: moment.videoId,
    momentId: moment._id,
    authorUserId: moment.authorUserId,
    processingStatus: 'ready',
    deletedAt: { $exists: false },
  });
  if (!video?.sourceMediaId || !video.fallbackPath || !video.posterPath) return null;

  const media = await getDatabase().collection('media').findOne({
    _id: video.sourceMediaId,
    userId: moment.authorUserId,
    status: 'approved',
    purpose: 'moment_video_source',
    fileType: 'video/mp4',
    deletedAt: { $exists: false },
  });
  if (!media) return null;

  return { moment, video };
}

async function loadSessionVideoMoment(req: Request, res: Response) {
  const userId = requireUserId(req, res);
  if (!userId) return null;
  if (!ObjectId.isValid(req.params.id)) {
    momentUnavailable(res);
    return null;
  }
  const session = await getMomentVideoPlaybackSessionsCollection().findOne({
    viewerUserId: userId,
    momentId: new ObjectId(req.params.id),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }, { sort: { createdAt: -1 } });
  if (!session) {
    momentUnavailable(res);
    return null;
  }

  const loaded = await loadAuthorizedVideoMoment(req.params.id, userId);
  if (!loaded || !loaded.video._id.equals(session.videoId)) {
    momentUnavailable(res);
    return null;
  }
  return loaded;
}

async function streamLocalFile(res: Response, path: string, contentType: string, rangeHeader?: string | string[]) {
  if (!isSafeLocalMediaPath(path)) {
    momentUnavailable(res);
    return;
  }

  let stat;
  try {
    stat = await fs.stat(path);
  } catch {
    momentUnavailable(res);
    return;
  }

  const size = stat.size;
  const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= size) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(path, { start, end }).pipe(res);
    return;
  }

  res.status(200);
  res.setHeader('Content-Length', String(size));
  createReadStream(path).pipe(res);
}

export const createMomentVideoPlaybackSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!ObjectId.isValid(req.params.id)) {
    momentUnavailable(res);
    return;
  }

  const loaded = await loadAuthorizedVideoMoment(req.params.id, userId);
  if (!loaded) {
    momentUnavailable(res);
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + MOMENT_VIDEO_PLAYBACK_SESSION_TTL_MS);
  await getMomentVideoPlaybackSessionsCollection().insertOne({
    _id: new ObjectId(),
    viewerUserId: userId,
    momentId: loaded.moment._id,
    videoId: loaded.video._id,
    createdAt: now,
    expiresAt,
    schemaVersion: 1,
  });

  res.status(201).json({ playback: { expiresAt } });
});

export const playbackMomentVideoFallback = asyncHandler(async (req: Request, res: Response) => {
  const loaded = await loadSessionVideoMoment(req, res);
  if (!loaded?.video?.fallbackPath) return;
  await streamLocalFile(res, loaded.video.fallbackPath, 'video/mp4', req.headers.range);
});

export const playbackMomentVideoPoster = asyncHandler(async (req: Request, res: Response) => {
  const loaded = await loadSessionVideoMoment(req, res);
  if (!loaded?.video?.posterPath) return;
  await streamLocalFile(res, loaded.video.posterPath, 'image/jpeg');
});

export const runMomentExpiryWorker = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (process.env.MOMENT_WORKER_HTTP_ENABLED !== 'true') {
    res.status(404).json({ error: 'Not Found', message: 'Not found' });
    return;
  }
  const result = await new MomentExpiryProcessor().runOnce(new Date());
  logger.info({ result }, 'Moment expiry worker run requested');
  res.status(200).json(result);
});
