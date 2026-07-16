import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getUserChatPreferencesCollection } from '../models/user-chat-preferences';

async function requireParticipant(chatId: ObjectId, userId: ObjectId) {
  const chat = await getChatsCollection().findOne({ _id: chatId, deletedAt: { $exists: false } });
  if (!chat) return null;
  return chat.participants.some((participantId) => participantId.equals(userId)) ? chat : null;
}

export const clearChatForMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }

  const chatId = new ObjectId(req.params.id);
  const userObjectId = new ObjectId(userId);
  const chat = await requireParticipant(chatId, userObjectId);
  if (!chat) {
    return res.status(404).json({ error: 'Not Found', message: 'Chat not found' });
  }

  const now = new Date();
  await getUserChatPreferencesCollection().updateOne(
    { userId: userObjectId, chatId },
    {
      $set: { clearedAt: now, updatedAt: now },
      $setOnInsert: { userId: userObjectId, chatId, pinned: false, archived: false, createdAt: now },
    },
    { upsert: true }
  );

  return res.status(200).json({ success: true, clearedAt: now });
});

export const removeDirectChatForMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }

  const chatId = new ObjectId(req.params.id);
  const userObjectId = new ObjectId(userId);
  const chat = await requireParticipant(chatId, userObjectId);
  if (!chat) {
    return res.status(404).json({ error: 'Not Found', message: 'Chat not found' });
  }
  if (chat.type !== 'direct') {
    return res.status(400).json({ error: 'Bad Request', message: 'Only direct conversations can be removed.' });
  }

  const now = new Date();
  await getUserChatPreferencesCollection().updateOne(
    { userId: userObjectId, chatId },
    {
      $set: { clearedAt: now, hiddenAt: now, archived: false, updatedAt: now },
      $unset: { archivedAt: '' },
      $setOnInsert: { userId: userObjectId, chatId, pinned: false, createdAt: now },
    },
    { upsert: true }
  );

  return res.status(200).json({ success: true, hiddenAt: now, clearedAt: now });
});
