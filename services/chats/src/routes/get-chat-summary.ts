import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getChatSummariesCollection } from '../models/chat-summary';
import { materializeSummarySources } from '../intelligence-source-materializer';
import { getDatabase } from '../db';
import { personalizeSummary } from '../summary-personalization';

interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  body: string;
  createdAt: Date;
  deletedFor?: ObjectId[];
}

interface UserDocument {
  _id: ObjectId;
  username?: string;
  name?: string;
}

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

  let summary = null;
  if (latestSummary) {
    const db = getDatabase();
    const [messages, viewer] = await Promise.all([
      db
        .collection<MessageDocument>('messages')
        .find({ chatId: chatObjectId, deletedFor: { $ne: userObjectId }, 'momentReply.isMomentReply': { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray(),
      db
        .collection<UserDocument>('users')
        .findOne({ _id: userObjectId }, { projection: { _id: 1, username: 1, name: 1 } }),
    ]);

    summary = await materializeSummarySources({
      summary: personalizeSummary({
        summary: latestSummary.summary,
        messages,
        viewer: viewer || { _id: userObjectId },
      }),
      chatId: chatObjectId,
      userId: userObjectId,
    });
  }

  return res.status(200).json({ summary });
});
