import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType, type ChatUpdatedEvent } from '@repo/types';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { serializeChat } from '../serialize-chat';
import { clearUserPrivateAiHistory, purgeGroupIntelligenceArtifacts } from '../ai-retention';
import { getPubSub } from '../pubsub';

const BodySchema = z.object({
  aiEnabled: z.boolean(),
});

export const updateGroupIntelligenceSettings = asyncHandler(async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid AI Intelligence settings' });
  }

  const chat = (req as any).chat;
  if (!chat) {
    return res.status(500).json({ error: 'Internal Server Error', message: 'Chat not found in request context' });
  }

  const now = new Date();
  const collection = getChatsCollection();
  const updatedChat = await collection.findOneAndUpdate(
    { _id: chat._id },
    { $set: { aiEnabled: parsed.data.aiEnabled, updatedAt: now } },
    { returnDocument: 'after' }
  );
  if (!updatedChat) {
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update AI Intelligence settings' });
  }

  const purge = parsed.data.aiEnabled ? null : await purgeGroupIntelligenceArtifacts(chat._id);
  try {
    await getPubSub().publish(
      createEvent<ChatUpdatedEvent>(EventType.CHAT_UPDATED, {
        chatId: updatedChat._id.toString(),
        name: updatedChat.title,
        avatar: updatedChat.avatarUrl,
        updatedBy: (req as any).user?.userId || 'system',
      })
    );
  } catch (error) {
    logger.error({ error, chatId: updatedChat._id.toString() }, 'Failed to publish chat updated event');
  }

  return res.status(200).json({ chat: await serializeChat(updatedChat, { includeParticipants: true }), purge });
});

export const clearMyAiHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });

  const purge = await clearUserPrivateAiHistory(new ObjectId(userId));
  return res.status(200).json({ status: 'cleared', purge });
});
