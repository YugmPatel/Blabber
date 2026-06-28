import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDatabase } from '../db';
import { Chat, getChatsCollection } from '../models/chat';
import {
  getGroupModerationActivityCollection,
  recordGroupModerationActivity,
} from '../models/group-moderation-activity';

const settingsSchema = z.object({
  sendMode: z.enum(['everyone', 'admins_only']),
});

function asObjectId(value: string) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function isOwner(chat: Chat, userId: ObjectId) {
  return Boolean(chat.ownerId?.equals(userId));
}

function isAdmin(chat: Chat, userId: ObjectId) {
  return chat.admins.some((adminId) => adminId.equals(userId));
}

function isParticipant(chat: Chat, userId: ObjectId) {
  return chat.participants.some((participantId) => participantId.equals(userId));
}

function assertCanModerate(chat: Chat, actorUserId: ObjectId, targetUserId?: ObjectId): string | null {
  if (!isAdmin(chat, actorUserId)) return 'Only group admins can perform this action';
  if (!targetUserId) return null;
  if (!isParticipant(chat, targetUserId)) return 'Target user is not a participant';
  if (actorUserId.equals(targetUserId)) return 'You cannot moderate yourself';
  if (isOwner(chat, targetUserId)) return 'The group owner cannot be moderated';
  if (!isOwner(chat, actorUserId) && isAdmin(chat, targetUserId)) return 'Only the group owner can moderate admins';
  return null;
}

async function loadGroup(req: Request, res: Response): Promise<Chat | null> {
  const chatId = asObjectId(req.params.id);
  if (!chatId) {
    res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
    return null;
  }
  const chat = await getChatsCollection().findOne({ _id: chatId, deletedAt: { $exists: false } });
  if (!chat) {
    res.status(404).json({ error: 'Not Found', message: 'Chat not found' });
    return null;
  }
  if (chat.type !== 'group') {
    res.status(400).json({ error: 'Bad Request', message: 'This operation is only available for group chats' });
    return null;
  }
  return chat;
}

export async function updateModerationSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = asObjectId((req as any).user?.userId);
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    const chat = await loadGroup(req, res);
    if (!chat) return;
    const moderationError = assertCanModerate(chat, actorId);
    if (moderationError) {
      res.status(403).json({ error: 'Forbidden', message: moderationError });
      return;
    }
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid moderation settings' });
      return;
    }
    const now = new Date();
    await getChatsCollection().updateOne(
      { _id: chat._id },
      { $set: { sendMode: parsed.data.sendMode, updatedAt: now } }
    );
    await recordGroupModerationActivity({
      chatId: chat._id,
      actorUserId: actorId,
      action: 'send_mode_changed',
      metadata: { sendMode: parsed.data.sendMode },
    });
    res.status(200).json({ sendMode: parsed.data.sendMode });
  } catch (error) {
    next(error);
  }
}

export async function restrictMember(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = asObjectId((req as any).user?.userId);
    const targetId = asObjectId(req.params.userId);
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    if (!targetId) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
      return;
    }
    const chat = await loadGroup(req, res);
    if (!chat) return;
    const moderationError = assertCanModerate(chat, actorId, targetId);
    if (moderationError) {
      res.status(403).json({ error: 'Forbidden', message: moderationError });
      return;
    }
    const now = new Date();
    await getChatsCollection().updateOne(
      { _id: chat._id },
      {
        $pull: { memberRestrictions: { userId: targetId } },
        $set: { updatedAt: now },
      }
    );
    await getChatsCollection().updateOne(
      { _id: chat._id },
      {
        $push: { memberRestrictions: { userId: targetId, restrictedBy: actorId, restrictedAt: now } },
        $set: { updatedAt: now },
      }
    );
    await recordGroupModerationActivity({
      chatId: chat._id,
      actorUserId: actorId,
      targetUserId: targetId,
      action: 'member_restricted',
    });
    res.status(200).json({ restricted: true });
  } catch (error) {
    next(error);
  }
}

export async function unrestrictMember(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = asObjectId((req as any).user?.userId);
    const targetId = asObjectId(req.params.userId);
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    if (!targetId) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
      return;
    }
    const chat = await loadGroup(req, res);
    if (!chat) return;
    const moderationError = assertCanModerate(chat, actorId, targetId);
    if (moderationError) {
      res.status(403).json({ error: 'Forbidden', message: moderationError });
      return;
    }
    await getChatsCollection().updateOne(
      { _id: chat._id },
      { $pull: { memberRestrictions: { userId: targetId } }, $set: { updatedAt: new Date() } }
    );
    await recordGroupModerationActivity({
      chatId: chat._id,
      actorUserId: actorId,
      targetUserId: targetId,
      action: 'member_unrestricted',
    });
    res.status(200).json({ restricted: false });
  } catch (error) {
    next(error);
  }
}

export async function moderationRemoveMember(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = asObjectId((req as any).user?.userId);
    const targetId = asObjectId(req.params.userId);
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    if (!targetId) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
      return;
    }
    const chat = await loadGroup(req, res);
    if (!chat) return;
    const moderationError = assertCanModerate(chat, actorId, targetId);
    if (moderationError) {
      res.status(403).json({ error: 'Forbidden', message: moderationError });
      return;
    }
    const remainingAdmins = chat.admins.filter((adminId) => !adminId.equals(targetId));
    if (isAdmin(chat, targetId) && remainingAdmins.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot remove the last admin' });
      return;
    }
    await getChatsCollection().updateOne(
      { _id: chat._id },
      {
        $pull: {
          participants: targetId,
          admins: targetId,
          memberRestrictions: { userId: targetId },
        },
        $set: { updatedAt: new Date() },
      }
    );
    await recordGroupModerationActivity({
      chatId: chat._id,
      actorUserId: actorId,
      targetUserId: targetId,
      action: 'member_removed',
    });
    res.status(200).json({ removed: true });
  } catch (error) {
    next(error);
  }
}

export async function listModerationActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = asObjectId((req as any).user?.userId);
    if (!actorId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    const chat = await loadGroup(req, res);
    if (!chat) return;
    if (!isAdmin(chat, actorId)) {
      res.status(403).json({ error: 'Forbidden', message: 'Only group admins can view moderation activity' });
      return;
    }
    const activity = await getGroupModerationActivityCollection()
      .find({ chatId: chat._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const userIds = Array.from(
      new Set(
        activity.flatMap((item) => [item.actorUserId?.toString(), item.targetUserId?.toString()].filter(Boolean))
      )
    ).map((id) => new ObjectId(id));
    const users = await getDatabase()
      .collection('users')
      .find({ _id: { $in: userIds } }, { projection: { name: 1, username: 1, avatarUrl: 1 } })
      .toArray();
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    res.status(200).json({
      activity: activity.map((item) => ({
        id: item._id.toString(),
        action: item.action,
        actor: usersById.get(item.actorUserId.toString()) || { _id: item.actorUserId, name: 'Deleted user' },
        target: item.targetUserId
          ? usersById.get(item.targetUserId.toString()) || { _id: item.targetUserId, name: 'Deleted user' }
          : undefined,
        metadata: item.metadata,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
}
