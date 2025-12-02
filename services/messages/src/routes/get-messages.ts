import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getMessagesCollection } from '../models/message';
import { logger } from '@repo/utils';

// Query parameters schema
const GetMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 50;
      const num = parseInt(val, 10);
      return isNaN(num) ? 50 : Math.min(Math.max(num, 1), 100);
    }),
});

export async function getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { chatId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    // Validate chatId
    if (!ObjectId.isValid(chatId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid chat ID' });
      return;
    }

    // Validate query parameters
    const queryResult = GetMessagesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid query parameters',
        details: queryResult.error.errors,
      });
      return;
    }

    const { cursor, limit } = queryResult.data;

    const collection = getMessagesCollection();
    const chatObjectId = new ObjectId(chatId);
    const userObjectId = new ObjectId(userId);

    // Build query
    const query: any = {
      chatId: chatObjectId,
      deletedFor: { $ne: userObjectId }, // Exclude messages deleted by this user
    };

    // Add cursor condition if provided
    if (cursor) {
      try {
        const cursorDoc = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
        query.$or = [
          { createdAt: { $lt: new Date(cursorDoc.createdAt) } },
          {
            createdAt: new Date(cursorDoc.createdAt),
            _id: { $lt: new ObjectId(cursorDoc._id) },
          },
        ];
      } catch (error) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid cursor' });
        return;
      }
    }

    // Fetch messages
    const messages = await collection
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1) // Fetch one extra to determine if there are more
      .toArray();

    // Determine if there are more messages
    const hasMore = messages.length > limit;
    const resultMessages = hasMore ? messages.slice(0, limit) : messages;

    // Generate next cursor
    let nextCursor: string | null = null;
    if (hasMore && resultMessages.length > 0) {
      const lastMessage = resultMessages[resultMessages.length - 1];
      const cursorData = {
        createdAt: lastMessage.createdAt.toISOString(),
        _id: lastMessage._id.toString(),
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
    }

    // Transform messages to API format
    const apiMessages = resultMessages.map((msg) => ({
      _id: msg._id.toString(),
      chatId: msg.chatId.toString(),
      senderId: msg.senderId.toString(),
      body: msg.body,
      media: msg.media,
      replyTo: msg.replyTo
        ? {
            messageId: msg.replyTo.messageId.toString(),
            body: msg.replyTo.body,
            senderId: msg.replyTo.senderId.toString(),
          }
        : undefined,
      reactions: msg.reactions.map((r) => ({
        userId: r.userId.toString(),
        emoji: r.emoji,
        createdAt: r.createdAt,
      })),
      status: msg.status,
      createdAt: msg.createdAt,
      editedAt: msg.editedAt,
    }));

    logger.info(
      {
        chatId,
        userId,
        count: apiMessages.length,
        hasMore,
      },
      'Messages retrieved'
    );

    res.status(200).json({
      messages: apiMessages,
      nextCursor,
    });
  } catch (error) {
    logger.error({ error, chatId: req.params.chatId }, 'Failed to retrieve messages');
    next(error);
  }
}
