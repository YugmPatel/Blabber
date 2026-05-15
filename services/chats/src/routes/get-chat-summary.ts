import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getChatSummariesCollection } from '../models/chat-summary';

export const getChatSummary = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  const { chatId } = req.params;

  if (!ObjectId.isValid(chatId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid chat ID',
    });
  }

  const chatObjectId = new ObjectId(chatId);
  const userObjectId = new ObjectId(userId);

  const chatsCollection = getChatsCollection();
  const chat = await chatsCollection.findOne({ _id: chatObjectId });

  if (!chat) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Chat not found',
    });
  }

  const isParticipant = chat.participants.some((participantId) => participantId.equals(userObjectId));
  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }

  const latestSummary = await getChatSummariesCollection().findOne(
    { chatId: chatObjectId },
    {
      sort: {
        createdAt: -1,
      },
    }
  );

  return res.status(200).json({
    summary: latestSummary?.summary ?? null,
  });
});