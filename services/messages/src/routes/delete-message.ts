import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventType, MessageDeletedEvent } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { createEvent, logger } from '@repo/utils';
import { assertChatMembership } from '../chat-access';
import { getPubSub } from '../pubsub';

export async function deleteMessage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    // Validate messageId
    if (!ObjectId.isValid(messageId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid message ID' });
      return;
    }

    const collection = getMessagesCollection();
    const messageObjectId = new ObjectId(messageId);
    const userObjectId = new ObjectId(userId);

    // Find the message
    const message = await collection.findOne({ _id: messageObjectId });

    if (!message) {
      res.status(404).json({ error: 'Not Found', message: 'Message not found' });
      return;
    }

    await assertChatMembership(message.chatId, userObjectId);

    if (!message.senderId.equals(userObjectId)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only delete your own messages',
      });
      return;
    }

    // Check if already deleted for this user
    if (message.deletedFor.some((id) => id.toString() === userId)) {
      res.status(200).json({ success: true, message: 'Message already deleted' });
      return;
    }

    // Soft delete: add user to deletedFor array
    await collection.updateOne(
      { _id: messageObjectId },
      {
        $addToSet: {
          deletedFor: userObjectId,
        },
      }
    );

    try {
      const pubsub = getPubSub();
      const event = createEvent<MessageDeletedEvent>(EventType.MESSAGE_DELETED, {
        messageId,
        chatId: message.chatId.toString(),
        deletedBy: userId,
      });
      await pubsub.publish(event);
    } catch (error) {
      logger.error({ error, messageId }, 'Failed to publish MESSAGE_DELETED event');
    }

    logger.info(
      {
        messageId,
        userId,
      },
      'Message deleted (soft delete)'
    );

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error({ error, messageId: req.params.messageId }, 'Failed to delete message');
    next(error);
  }
}
