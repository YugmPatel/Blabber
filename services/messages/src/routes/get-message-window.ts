import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getMessagesCollection } from '../models/message';
import { serializeMessage } from '../serialize-message';
import { assertChatMembership } from '../chat-access';
import { logger } from '@repo/utils';

const MessageWindowQuerySchema = z.object({
  chatId: z.string(),
  before: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = value ? parseInt(value, 10) : 20;
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
    }),
  after: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = value ? parseInt(value, 10) : 20;
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
    }),
});

export async function getMessageWindow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    if (!ObjectId.isValid(messageId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid message ID' });
      return;
    }

    const queryResult = MessageWindowQuerySchema.safeParse(req.query);
    if (!queryResult.success || !ObjectId.isValid(queryResult.data.chatId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid message window query' });
      return;
    }

    const userObjectId = new ObjectId(userId);
    const chatObjectId = new ObjectId(queryResult.data.chatId);
    const messageObjectId = new ObjectId(messageId);
    await assertChatMembership(chatObjectId, userObjectId);

    const collection = getMessagesCollection();
    const target = await collection.findOne({
      _id: messageObjectId,
      chatId: chatObjectId,
      deletedFor: { $ne: userObjectId },
    });
    if (!target) {
      res.status(404).json({ error: 'Not Found', message: 'This source message is no longer available.' });
      return;
    }

    const older = await collection
      .find({
        chatId: chatObjectId,
        deletedFor: { $ne: userObjectId },
        $or: [
          { createdAt: { $lt: target.createdAt } },
          { createdAt: target.createdAt, _id: { $lt: target._id } },
        ],
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(queryResult.data.before)
      .toArray();

    const newer = await collection
      .find({
        chatId: chatObjectId,
        deletedFor: { $ne: userObjectId },
        $or: [
          { createdAt: { $gt: target.createdAt } },
          { createdAt: target.createdAt, _id: { $gt: target._id } },
        ],
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(queryResult.data.after)
      .toArray();

    const messages = [...newer.reverse(), target, ...older].map((message) =>
      serializeMessage(message, undefined, userObjectId)
    );
    res.status(200).json({
      messages,
      targetMessageId: target._id.toString(),
    });
  } catch (error) {
    logger.error({ error, messageId: req.params.messageId }, 'Failed to retrieve source message window');
    next(error);
  }
}
