import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventType, MarkReadDTOSchema, MessageReadEvent } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { getDatabase } from '../db';
import { createEvent, logger } from '@repo/utils';
import { assertChatMembership } from '../chat-access';
import { getPubSub } from '../pubsub';

export async function markMessagesAsRead(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    // Validate request body
    const bodyResult = MarkReadDTOSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: bodyResult.error.errors,
      });
      return;
    }

    const { messageIds } = bodyResult.data;

    // Validate all message IDs
    const invalidIds = messageIds.filter((id) => !ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid message IDs',
        invalidIds,
      });
      return;
    }

    const collection = getMessagesCollection();
    const db = getDatabase();
    const messageObjectIds = messageIds.map((id) => new ObjectId(id));
    const userObjectId = new ObjectId(userId);
    const settings = await db.collection('userSettings').findOne({ userId: userObjectId });
    const readReceiptsEnabled = settings?.readReceiptsEnabled !== false;

    const messages = await collection
      .find({ _id: { $in: messageObjectIds } }, { projection: { _id: 1, chatId: 1, createdAt: 1 } })
      .toArray();

    if (messages.length !== messageObjectIds.length) {
      res.status(404).json({ error: 'Not Found', message: 'One or more messages were not found' });
      return;
    }

    const chatIds = Array.from(new Set(messages.map((message) => message.chatId.toString())));
    await Promise.all(chatIds.map((chatId) => assertChatMembership(new ObjectId(chatId), userObjectId)));

    // Batch update: mark all messages as read
    // Only update messages that are not already read
    const result = readReceiptsEnabled
      ? await collection.updateMany(
          {
            _id: { $in: messageObjectIds },
            senderId: { $ne: userObjectId },
            status: { $ne: 'read' },
          },
          {
            $set: {
              status: 'read',
            },
          }
        )
      : { modifiedCount: 0 };

    await Promise.all(
      chatIds.map((chatId) => {
        const latestReadAt = messages
          .filter((message) => message.chatId.toString() === chatId)
          .reduce<Date | null>((latest, message: any) => {
            const createdAt = message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);
            return !latest || createdAt > latest ? createdAt : latest;
          }, null);

        if (!latestReadAt) return Promise.resolve();

        return db.collection('chatReadStates').updateOne(
          { userId: userObjectId, chatId: new ObjectId(chatId) },
          {
            $max: { lastReadAt: latestReadAt },
            $set: { updatedAt: new Date() },
            $setOnInsert: {
              userId: userObjectId,
              chatId: new ObjectId(chatId),
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      })
    );

    logger.info(
      {
        userId,
        messageCount: messageIds.length,
        modifiedCount: result.modifiedCount,
      },
      'Messages marked as read'
    );

    if (readReceiptsEnabled) try {
      const pubsub = getPubSub();
      await Promise.all(
        chatIds.map((chatId) => {
          const idsForChat = messages
            .filter((message) => message.chatId.toString() === chatId)
            .map((message) => message._id.toString());

          const event = createEvent<MessageReadEvent>(EventType.MESSAGE_READ, {
            chatId,
            userId,
            messageIds: idsForChat,
          });

          return pubsub.publish(event);
        })
      );
    } catch (error) {
      logger.error({ error, userId, messageIds }, 'Failed to publish MESSAGE_READ event');
    }

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to mark messages as read');
    next(error);
  }
}
