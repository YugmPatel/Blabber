import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventType, MessageEditedEvent } from '@repo/types';
import { createEvent, logger } from '@repo/utils';
import { getMessagesCollection } from '../models/message';
import { assertChatMembership } from '../chat-access';
import { serializeMessage } from '../serialize-message';
import { getPubSub } from '../pubsub';

async function publishMessageEdited(message: ReturnType<typeof serializeMessage>) {
  try {
    await getPubSub().publish(createEvent<MessageEditedEvent>(EventType.MESSAGE_EDITED, {
      messageId: message._id,
      chatId: message.chatId,
      content: message.body,
      message,
      editedAt: new Date().toISOString(),
    }));
  } catch (error) {
    logger.error({ error, messageId: message._id }, 'Failed to publish poll update');
  }
}

export async function closePoll(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const userObjectId = new ObjectId(userId);
    const messageObjectId = new ObjectId(messageId);
    const collection = getMessagesCollection();
    const message = await collection.findOne({ _id: messageObjectId });
    if (!message?.poll) {
      res.status(404).json({ error: 'Not Found', message: 'Poll message not found' });
      return;
    }

    await assertChatMembership(message.chatId, userObjectId);
    const creatorId = message.poll.createdBy || message.senderId;
    if (!creatorId.equals(userObjectId)) {
      res.status(403).json({ error: 'Forbidden', message: 'Only the poll creator can close this poll' });
      return;
    }

    const now = new Date();
    const updated = await collection.findOneAndUpdate(
      { _id: messageObjectId },
      { $set: { 'poll.closed': true, 'poll.closedAt': now, 'poll.closedBy': userObjectId, editedAt: now } },
      { returnDocument: 'after' }
    );
    if (!updated) {
      res.status(404).json({ error: 'Not Found', message: 'Poll message not found' });
      return;
    }

    const apiMessage = serializeMessage(updated, undefined, userObjectId);
    await publishMessageEdited(apiMessage);
    res.status(200).json(apiMessage);
  } catch (error) {
    next(error);
  }
}
