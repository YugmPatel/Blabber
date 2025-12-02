import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { AddReactionDTOSchema } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { logger } from '@repo/utils';

export async function reactToMessage(
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

    // Validate request body
    const bodyResult = AddReactionDTOSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: bodyResult.error.errors,
      });
      return;
    }

    const { emoji } = bodyResult.data;

    const collection = getMessagesCollection();
    const messageObjectId = new ObjectId(messageId);
    const userObjectId = new ObjectId(userId);

    // Find the message
    const message = await collection.findOne({ _id: messageObjectId });

    if (!message) {
      res.status(404).json({ error: 'Not Found', message: 'Message not found' });
      return;
    }

    // Check if user already has a reaction on this message
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.userId.toString() === userId
    );

    let result;

    if (existingReactionIndex !== -1) {
      // Update existing reaction (one emoji per user)
      result = await collection.findOneAndUpdate(
        { _id: messageObjectId, 'reactions.userId': userObjectId },
        {
          $set: {
            'reactions.$.emoji': emoji,
            'reactions.$.createdAt': new Date(),
          },
        },
        { returnDocument: 'after' }
      );
    } else {
      // Add new reaction
      result = await collection.findOneAndUpdate(
        { _id: messageObjectId },
        {
          $push: {
            reactions: {
              userId: userObjectId,
              emoji,
              createdAt: new Date(),
            },
          },
        },
        { returnDocument: 'after' }
      );
    }

    if (!result) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to add reaction' });
      return;
    }

    // Transform to API format
    const apiMessage = {
      _id: result._id.toString(),
      chatId: result.chatId.toString(),
      senderId: result.senderId.toString(),
      body: result.body,
      media: result.media,
      replyTo: result.replyTo
        ? {
            messageId: result.replyTo.messageId.toString(),
            body: result.replyTo.body,
            senderId: result.replyTo.senderId.toString(),
          }
        : undefined,
      reactions: result.reactions.map((r) => ({
        userId: r.userId.toString(),
        emoji: r.emoji,
        createdAt: r.createdAt,
      })),
      status: result.status,
      createdAt: result.createdAt,
      editedAt: result.editedAt,
    };

    logger.info(
      {
        messageId,
        userId,
        emoji,
      },
      'Reaction added/updated'
    );

    res.status(200).json(apiMessage);
  } catch (error) {
    logger.error({ error, messageId: req.params.messageId }, 'Failed to add reaction');
    next(error);
  }
}
