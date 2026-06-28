import { Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType, type ChatMemberAddedEvent, type ChatUpdatedEvent } from '@repo/types';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getGroupInviteLinksCollection, GroupInviteLink } from '../models/group-invite-link';
import { getDatabase } from '../db';
import { isChatExpired, serializeChat } from '../serialize-chat';
import { getPubSub } from '../pubsub';

const TOKEN_BYTES = 32;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

const SettingsSchema = z.object({
  expiresIn: z.enum(['never', '1d', '7d', '30d']).optional().default('never'),
  maxUses: z.union([z.enum(['unlimited']), z.literal(10), z.literal(50), z.literal(100)]).optional().default('unlimited'),
});

function checkRateLimit(key: string) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function safeTokenFromRequest(raw: string | undefined) {
  if (!raw || raw.length < 20 || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function expiresAtFor(value: z.infer<typeof SettingsSchema>['expiresIn']) {
  if (value === 'never') return null;
  const days = value === '1d' ? 1 : value === '7d' ? 7 : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function maxUsesFor(value: z.infer<typeof SettingsSchema>['maxUses']) {
  return value === 'unlimited' ? null : value;
}

function settingsFromInvite(invite?: GroupInviteLink | null) {
  if (!invite) return null;
  return {
    id: invite._id?.toString(),
    chatId: invite.chatId.toString(),
    createdBy: invite.createdBy.toString(),
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt || null,
    maxUses: invite.maxUses || null,
    useCount: invite.useCount,
    revokedAt: invite.revokedAt || null,
    active: !invite.revokedAt && (!invite.expiresAt || invite.expiresAt > new Date()) && (!invite.maxUses || invite.useCount < invite.maxUses),
  };
}

function isAdminOrOwner(chat: any, userId: ObjectId) {
  return Boolean(chat.ownerId?.equals(userId) || chat.admins?.some((adminId: ObjectId) => adminId.equals(userId)));
}

async function requireManageableGroup(chatId: ObjectId, userId: ObjectId) {
  const chat = await getChatsCollection().findOne({ _id: chatId, deletedAt: { $exists: false } });
  if (!chat) return { status: 404 as const, body: { error: 'Not Found', message: 'Chat not found' } };
  if (chat.type !== 'group') return { status: 400 as const, body: { error: 'Bad Request', message: 'Invite links are only available for groups' } };
  if (isChatExpired(chat)) return { status: 400 as const, body: { error: 'Bad Request', message: 'This group cannot use invite links' } };
  if (!isAdminOrOwner(chat, userId)) return { status: 403 as const, body: { error: 'Forbidden', message: 'Only group owners and admins can manage invite links' } };
  return { chat };
}

async function publishMemberAdded(chat: any, userId: string, addedBy: string) {
  try {
    await getPubSub().publish(createEvent<ChatMemberAddedEvent>(EventType.CHAT_MEMBER_ADDED, {
      chatId: chat._id.toString(),
      userId,
      addedBy,
    }));
    await getPubSub().publish(createEvent<ChatUpdatedEvent>(EventType.CHAT_UPDATED, {
      chatId: chat._id.toString(),
      name: chat.title,
      avatar: chat.avatarUrl,
      updatedBy: addedBy,
    }));
  } catch (error) {
    logger.error({ error, chatId: chat._id.toString(), userId }, 'Failed to publish invite join events');
  }
}

function inviteFailure(res: Response, message = 'This invite link is unavailable.') {
  return res.status(404).json({ error: 'Invite Unavailable', message });
}

async function findUsableInvite(token: string) {
  const tokenHash = hashToken(token);
  return getGroupInviteLinksCollection().findOne({
    tokenHash,
    revokedAt: null,
  });
}

function tokenMatches(token: string, tokenHash: string) {
  const left = Buffer.from(hashToken(token));
  const right = Buffer.from(tokenHash);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const getInviteLinkSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const { id } = req.params;
  if (!userId || !ObjectId.isValid(id)) {
    return res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid chat ID' : 'User not authenticated' });
  }
  const result = await requireManageableGroup(new ObjectId(id), new ObjectId(userId));
  if ('status' in result) return res.status(result.status ?? 400).json(result.body);
  const invite = await getGroupInviteLinksCollection().findOne({ chatId: new ObjectId(id), revokedAt: null });
  return res.status(200).json({ invite: settingsFromInvite(invite) });
});

export const createInviteLink = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const { id } = req.params;
  if (!userId || !ObjectId.isValid(id)) {
    return res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid chat ID' : 'User not authenticated' });
  }
  if (!checkRateLimit(`manage:${userId}`)) {
    return res.status(429).json({ error: 'Too Many Requests', message: 'Too many invite-link requests. Try again soon.' });
  }
  const settings = SettingsSchema.safeParse(req.body || {});
  if (!settings.success) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid invite settings' });
  }
  const chatId = new ObjectId(id);
  const result = await requireManageableGroup(chatId, new ObjectId(userId));
  if ('status' in result) return res.status(result.status ?? 400).json(result.body);

  const existing = await getGroupInviteLinksCollection().findOne({ chatId, revokedAt: null });
  if (existing) {
    return res.status(409).json({ error: 'Conflict', message: 'An active invite link already exists' });
  }

  const token = createToken();
  const now = new Date();
  const invite = {
    chatId,
    tokenHash: hashToken(token),
    createdBy: new ObjectId(userId),
    createdAt: now,
    expiresAt: expiresAtFor(settings.data.expiresIn),
    maxUses: maxUsesFor(settings.data.maxUses),
    useCount: 0,
    revokedAt: null,
    lastUsedAt: null,
  };
  await getGroupInviteLinksCollection().insertOne(invite);
  return res.status(201).json({ invite: settingsFromInvite(invite), token });
});

export const regenerateInviteLink = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const { id } = req.params;
  if (!userId || !ObjectId.isValid(id)) {
    return res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid chat ID' : 'User not authenticated' });
  }
  if (!checkRateLimit(`manage:${userId}`)) {
    return res.status(429).json({ error: 'Too Many Requests', message: 'Too many invite-link requests. Try again soon.' });
  }
  const settings = SettingsSchema.safeParse(req.body || {});
  if (!settings.success) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid invite settings' });
  }
  const chatId = new ObjectId(id);
  const result = await requireManageableGroup(chatId, new ObjectId(userId));
  if ('status' in result) return res.status(result.status ?? 400).json(result.body);

  const now = new Date();
  await getGroupInviteLinksCollection().updateMany(
    { chatId, revokedAt: null },
    { $set: { revokedAt: now } }
  );
  const token = createToken();
  const invite = {
    chatId,
    tokenHash: hashToken(token),
    createdBy: new ObjectId(userId),
    createdAt: now,
    expiresAt: expiresAtFor(settings.data.expiresIn),
    maxUses: maxUsesFor(settings.data.maxUses),
    useCount: 0,
    revokedAt: null,
    lastUsedAt: null,
  };
  await getGroupInviteLinksCollection().insertOne(invite);
  return res.status(201).json({ invite: settingsFromInvite(invite), token });
});

export const revokeInviteLink = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const { id } = req.params;
  if (!userId || !ObjectId.isValid(id)) {
    return res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid chat ID' : 'User not authenticated' });
  }
  if (!checkRateLimit(`manage:${userId}`)) {
    return res.status(429).json({ error: 'Too Many Requests', message: 'Too many invite-link requests. Try again soon.' });
  }
  const chatId = new ObjectId(id);
  const result = await requireManageableGroup(chatId, new ObjectId(userId));
  if ('status' in result) return res.status(result.status ?? 400).json(result.body);
  await getGroupInviteLinksCollection().updateMany(
    { chatId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return res.status(200).json({ invite: null });
});

export const previewInvite = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const token = safeTokenFromRequest(req.params.token);
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  if (!checkRateLimit(`preview:${userId}`) || !token) return inviteFailure(res);

  const invite = await findUsableInvite(token);
  if (!invite || !tokenMatches(token, invite.tokenHash)) return inviteFailure(res);
  if (invite.expiresAt && invite.expiresAt <= new Date()) return inviteFailure(res, 'This invite link has expired.');
  if (invite.maxUses && invite.useCount >= invite.maxUses) return inviteFailure(res, 'This invite link has reached its usage limit.');

  const chat = await getChatsCollection().findOne({ _id: invite.chatId, deletedAt: { $exists: false } });
  if (!chat || chat.type !== 'group' || isChatExpired(chat)) return inviteFailure(res);

  const userObjectId = new ObjectId(userId);
  const alreadyMember = chat.participants.some((participantId) => participantId.equals(userObjectId));
  return res.status(200).json({
    invite: {
      groupName: chat.title || 'Group chat',
      groupAvatarUrl: chat.avatarUrl,
      alreadyMember,
      chatId: alreadyMember ? chat._id.toString() : undefined,
      expiresAt: invite.expiresAt || null,
      maxUses: invite.maxUses || null,
      useCount: invite.useCount,
    },
  });
});

export const joinInvite = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const token = safeTokenFromRequest(req.params.token);
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  if (!checkRateLimit(`join:${userId}`) || !token) return inviteFailure(res);

  const invite = await findUsableInvite(token);
  if (!invite || !tokenMatches(token, invite.tokenHash)) return inviteFailure(res);
  if (invite.expiresAt && invite.expiresAt <= new Date()) return inviteFailure(res, 'This invite link has expired.');

  const userObjectId = new ObjectId(userId);
  const chat = await getChatsCollection().findOne({ _id: invite.chatId, deletedAt: { $exists: false } });
  if (!chat || chat.type !== 'group' || isChatExpired(chat)) return inviteFailure(res);
  if (chat.participants.some((participantId) => participantId.equals(userObjectId))) {
    return res.status(200).json({ chat: await serializeChat(chat, { includeParticipants: true }), alreadyMember: true });
  }
  const userExists = await getDatabase().collection('users').findOne({ _id: userObjectId });
  if (!userExists) return inviteFailure(res, 'You cannot join this group.');

  const now = new Date();
  const inviteUpdateQuery: any = {
    _id: invite._id,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }, { expiresAt: { $exists: false } }],
  };
  if (invite.maxUses) {
    inviteUpdateQuery.useCount = { $lt: invite.maxUses };
  }

  const consumed = await getGroupInviteLinksCollection().findOneAndUpdate(
    inviteUpdateQuery,
    { $inc: { useCount: 1 }, $set: { lastUsedAt: now } },
    { returnDocument: 'after' }
  );
  if (!consumed) {
    return inviteFailure(res, invite.maxUses ? 'This invite link has reached its usage limit.' : 'This invite link is unavailable.');
  }

  const chatResult = await getChatsCollection().findOneAndUpdate(
    {
      _id: invite.chatId,
      type: 'group',
      deletedAt: { $exists: false },
      participants: { $ne: userObjectId },
    },
    {
      $push: { participants: userObjectId },
      $set: { updatedAt: now },
    },
    { returnDocument: 'after' }
  );
  if (!chatResult) return inviteFailure(res, 'You cannot join this group.');

  await publishMemberAdded(chatResult, userId, userId);
  return res.status(200).json({ chat: await serializeChat(chatResult, { includeParticipants: true }), alreadyMember: false });
});
