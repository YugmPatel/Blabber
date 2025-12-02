import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { MarkReadDTOSchema } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { logger } from '@repo/utils';

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
    const messageObjectIds = messageIds.map((id) => new ObjectId(id));

    // Batch update: mark all messages as read
    // Only update messages that are not already read
    const result = await collection.updateMany(
      {
        _id: { $in: messageObjectIds },
        status: { $ne: 'read' },
      },
      {
        $set: {
          status: 'read',
        },
      }
    );

    logger.info(
      {
        userId,
        messageCount: messageIds.length,
        modifiedCount: result.modifiedCount,
      },
      'Messages marked as read'
    );

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to mark messages as read');
    next(error);
  }
}
