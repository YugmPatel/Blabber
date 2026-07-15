import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventType, MessageEditedEvent, PollVoteDTOSchema } from '@repo/types';
import { createEvent, logger } from '@repo/utils';
import { getMessagesCollection } from '../models/message';
import { getPubSub } from '../pubsub';
import { serializeMessage } from '../serialize-message';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { getPollVoteRecords, isPollClosed } from '../poll-utils';

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

    const chat = await assertChatMembership(message.chatId, voterObjectId);
    // Voting edits the poll and notifies the other participant, so a blocked
    // direct chat must reject it the same as a new message. It is not
    // "sending a message" though, so an admins-only group doesn't block
    // votes from non-admin members.
    await assertChatWritable(chat, voterObjectId, { enforceSendMode: false });

    if (isPollClosed(message.poll)) {
      res.status(400).json({ error: 'Bad Request', message: 'Poll is closed' });
      return;
    }

    const requestedOptionIds = bodyResult.data.optionIds || (bodyResult.data.optionId ? [bodyResult.data.optionId] : []);
    const optionIds = Array.from(new Set(requestedOptionIds));
    if (!message.poll.allowMultiple && optionIds.length > 1) {
      res.status(400).json({ error: 'Bad Request', message: 'Poll allows only one option' });
      return;
    }

    const validOptionIds = new Set(message.poll.options.map((option) => option.id));
    if (optionIds.some((optionId) => !validOptionIds.has(optionId))) {
      res.status(400).json({ error: 'Bad Request', message: 'Poll option not found' });
      return;
    }

    const existingVotes = getPollVoteRecords(message.poll);
    const existingVote = existingVotes.find((vote) => vote.userId.equals(voterObjectId));
    if (existingVote && message.poll.allowVoteChanges === false) {
      res.status(400).json({ error: 'Bad Request', message: 'Poll vote changes are disabled' });
      return;
    }

    const now = new Date();
    const votes = [
      ...existingVotes.filter((vote) => !vote.userId.equals(voterObjectId)),
      {
        userId: voterObjectId,
        optionIds,
        votedAt: existingVote?.votedAt && existingVote.votedAt.getTime() > 0 ? existingVote.votedAt : now,
        updatedAt: now,
      },
    ];
    const options = message.poll.options.map((option) => ({
      ...option,
      votes: votes.filter((vote) => vote.optionIds.includes(option.id)).map((vote) => vote.userId),
      voteCount: votes.filter((vote) => vote.optionIds.includes(option.id)).length,
    }));

    const updated = await collection.findOneAndUpdate(
      { _id: messageObjectId },
      {
        $set: {
          'poll.options': options,
          'poll.votes': votes,
          editedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update poll' });
      return;
    }

    const apiMessage = serializeMessage(updated, undefined, voterObjectId);

    try {
      const pubsub = getPubSub();
      const event = createEvent<MessageEditedEvent>(EventType.MESSAGE_EDITED, {
        messageId: apiMessage._id,
        chatId: apiMessage.chatId,
        content: apiMessage.body,
        message: apiMessage,
        participants: chat.participants.map((participantId) => participantId.toString()),
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
