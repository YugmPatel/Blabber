import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { serializeChat } from '../serialize-chat';

export const getChat = asyncHandler(async (req: Request, res: Response) => {
  // Get authenticated user ID from middleware
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  const { id } = req.params;

  // Validate chat ID
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid chat ID',
    });
  }

  const chatId = new ObjectId(id);
  const userObjectId = new ObjectId(userId);

  const collection = getChatsCollection();

  // Find chat by ID
  const chat = await collection.findOne({ _id: chatId, deletedAt: { $exists: false } });

  if (!chat) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Chat not found',
    });
  }

  // Verify user is a participant
  const isParticipant = chat.participants.some((participantId) =>
    participantId.equals(userObjectId)
  );

  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }

  const serializedChat = await serializeChat(chat, { includeParticipants: true, viewerId: userObjectId });

  return res.status(200).json({
    chat: serializedChat,
  });
});
