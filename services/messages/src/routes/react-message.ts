import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { AddReactionDTOSchema, EventType, MessageReactionEvent } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { createEvent, logger } from '@repo/utils';
import { serializeMessage } from '../serialize-message';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { getPubSub } from '../pubsub';

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

    const chat = await assertChatMembership(message.chatId, userObjectId);
    // Reacting creates a new interaction the other participant is notified
    // of, so a blocked direct chat must reject it the same as a new message.
    // It is not "sending a message" though, so an admins-only group doesn't
    // block reactions from non-admin members.
    await assertChatWritable(chat, userObjectId, { enforceSendMode: false });

    // Check if user already has a reaction on this message
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.userId.toString() === userId
    );
    const existingReaction = existingReactionIndex !== -1 ? message.reactions[existingReactionIndex] : null;

    let result;
    let operation: 'set' | 'remove' = 'set';

    if (existingReaction?.emoji === emoji) {
      operation = 'remove';
      result = await collection.findOneAndUpdate(
        { _id: messageObjectId },
        {
          $pull: {
            reactions: {
              userId: userObjectId,
            },
          },
        },
        { returnDocument: 'after' }
      );
    } else if (existingReactionIndex !== -1) {
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

    const apiMessage = serializeMessage(result, undefined, userObjectId);

    try {
      const pubsub = getPubSub();
      const event = createEvent<MessageReactionEvent>(EventType.MESSAGE_REACTION, {
        messageId,
        chatId: apiMessage.chatId,
        userId,
        emoji,
        operation,
        reactions: apiMessage.reactions,
        message: apiMessage,
      });
      await pubsub.publish(event);
    } catch (error) {
      logger.error({ error, messageId }, 'Failed to publish MESSAGE_REACTION event');
    }

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
