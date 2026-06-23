import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventType, MessageEditedEvent, PollVoteDTOSchema } from '@repo/types';
import { createEvent, logger } from '@repo/utils';
import { getMessagesCollection } from '../models/message';
import { getPubSub } from '../pubsub';
import { serializeMessage } from '../serialize-message';
import { assertChatMembership } from '../chat-access';

export async function votePoll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    if (!ObjectId.isValid(messageId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid message ID' });
      return;
    }

    const bodyResult = PollVoteDTOSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: bodyResult.error.errors,
      });
      return;
    }

    const collection = getMessagesCollection();
    const messageObjectId = new ObjectId(messageId);
    const voterObjectId = new ObjectId(userId);
    const message = await collection.findOne({ _id: messageObjectId });

    if (!message?.poll) {
      res.status(404).json({ error: 'Not Found', message: 'Poll message not found' });
      return;
    }

    await assertChatMembership(message.chatId, voterObjectId);

    if (message.poll.closed) {
      res.status(400).json({ error: 'Bad Request', message: 'Poll is closed' });
      return;
    }

    const targetOption = message.poll.options.find((option) => option.id === bodyResult.data.optionId);
    if (!targetOption) {
      res.status(400).json({ error: 'Bad Request', message: 'Poll option not found' });
      return;
    }

    const options = message.poll.options.map((option) => ({
      ...option,
      votes: message.poll?.allowMultiple
        ? option.votes
        : option.votes.filter((vote) => !vote.equals(voterObjectId)),
    }));
    const optionToUpdate = options.find((option) => option.id === bodyResult.data.optionId);
    if (optionToUpdate && !optionToUpdate.votes.some((vote) => vote.equals(voterObjectId))) {
      optionToUpdate.votes.push(voterObjectId);
    }

    const updated = await collection.findOneAndUpdate(
      { _id: messageObjectId },
      {
        $set: {
          'poll.options': options,
          editedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update poll' });
      return;
    }

    const apiMessage = serializeMessage(updated);

    try {
      const pubsub = getPubSub();
      const event = createEvent<MessageEditedEvent>(EventType.MESSAGE_EDITED, {
        messageId: apiMessage._id,
        chatId: apiMessage.chatId,
        content: apiMessage.body,
        message: apiMessage,
        editedAt: new Date().toISOString(),
      });
      await pubsub.publish(event);
    } catch (error) {
      logger.error({ error, messageId }, 'Failed to publish poll vote update');
    }

    res.status(200).json(apiMessage);
  } catch (error) {
    logger.error({ error, messageId: req.params.messageId }, 'Failed to vote on poll');
    next(error);
  }
}
