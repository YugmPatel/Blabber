import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getMessagesCollection } from '../models/message';
import { logger } from '@repo/utils';

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
