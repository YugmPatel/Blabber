import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType, MessageSentEvent } from '@repo/types';
import { createEvent, logger } from '@repo/utils';
import { getDatabase } from '../db';
import { getMessagesCollection, MessageDocument } from '../models/message';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { getPubSub } from '../pubsub';
import { serializeMessage } from '../serialize-message';
import { unarchiveChatForParticipants } from '../chat-state';

const forwardSchema = z.object({
  destinationChatIds: z.array(z.string()).min(1).max(10),
});

const MEDIA_UPLOAD_ERROR = 'This file could not be uploaded.';

function clonePoll(message: MessageDocument, userObjectId: ObjectId) {
  if (!message.poll) return undefined;
  return {
    question: message.poll.question,
    options: message.poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      votes: [],
      voteCount: 0,
    })),
    allowMultiple: message.poll.allowMultiple ?? false,
    allowVoteChanges: message.poll.allowVoteChanges ?? true,
    showVoters: message.poll.showVoters ?? false,
    closesAt: message.poll.closesAt,
    createdBy: userObjectId,
    votes: [],
    closed: false,
  };
}

function cloneEvent(message: MessageDocument, userObjectId: ObjectId) {
  if (!message.event) return undefined;
  return {
    title: message.event.title,
    startsAt: message.event.startAt?.toISOString() || message.event.startsAt,
    startAt: message.event.startAt,
    endAt: message.event.endAt,
    timezone: message.event.timezone,
    location: message.event.location,
    meetingUrl: message.event.meetingUrl,
    description: message.event.description,
    createdBy: userObjectId,
    updatedAt: new Date(),
    reminderEnabled: message.event.reminderEnabled ?? true,
    rsvps: [
      {
        userId: userObjectId,
        status: 'going' as const,
        respondedAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
}

function cloneMessageContent(message: MessageDocument, userObjectId: ObjectId) {
  return {
    type: message.type ?? (message.media?.type || (message.poll ? 'poll' : message.sticker ? 'sticker' : message.event ? 'event' : 'text')),
    body: message.body,
    media: message.media ? { ...message.media } : undefined,
    poll: clonePoll(message, userObjectId),
    sticker: message.sticker ? { ...message.sticker } : undefined,
    event: cloneEvent(message, userObjectId),
  };
}

export async function forwardMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const parsed = forwardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid forward request',
        details: parsed.error.errors,
      });
      return;
    }

    const uniqueDestinationIds = Array.from(new Set(parsed.data.destinationChatIds));
    if (uniqueDestinationIds.some((chatId) => !ObjectId.isValid(chatId))) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid destination chat ID' });
      return;
    }

    const userObjectId = new ObjectId(userId);
    const collection = getMessagesCollection();
    const sourceMessage = await collection.findOne({
      _id: new ObjectId(messageId),
      deletedFor: { $ne: userObjectId },
    });

    if (!sourceMessage) {
      res.status(404).json({ error: 'Not Found', message: 'Message not found' });
      return;
    }

    await assertChatMembership(sourceMessage.chatId, userObjectId);

    const destinationChats = [];
    for (const destinationId of uniqueDestinationIds) {
      const chat = await assertChatMembership(new ObjectId(destinationId), userObjectId);
      await assertChatWritable(chat, userObjectId);
      destinationChats.push(chat);
    }

    const db = getDatabase();
    const sender = await db.collection('users').findOne(
      { _id: userObjectId },
      { projection: { name: 1, username: 1 } }
    );
    const senderName = sender?.name || sender?.username || 'Someone';
    const content = cloneMessageContent(sourceMessage, userObjectId);
    if (content.media?.mediaId) {
      if (!(content.media.mediaId instanceof ObjectId) && !ObjectId.isValid(String(content.media.mediaId))) {
        res.status(400).json({ error: 'Bad Request', message: MEDIA_UPLOAD_ERROR });
        return;
      }
      const mediaId = content.media.mediaId instanceof ObjectId ? content.media.mediaId : new ObjectId(String(content.media.mediaId));
      const mediaDoc = await db.collection('media').findOne(
        { _id: mediaId, status: 'approved' },
        { projection: { _id: 1, url: 1, fileType: 1, fileSize: 1, s3Key: 1, fileName: 1 } }
      );
      if (!mediaDoc?.url) {
        res.status(400).json({ error: 'Bad Request', message: MEDIA_UPLOAD_ERROR });
        return;
      }
      content.media = {
        ...content.media,
        url: mediaDoc.url,
        mediaId: mediaDoc._id,
        storageKey: mediaDoc.s3Key,
        fileName: mediaDoc.fileName,
        mimeType: mediaDoc.fileType,
        size: mediaDoc.fileSize,
      };
    }
    const createdMessages: MessageDocument[] = [];

    for (const chat of destinationChats) {
      const now = new Date();
      const messageDoc: MessageDocument = {
        _id: new ObjectId(),
        chatId: chat._id,
        senderId: userObjectId,
        type: content.type as MessageDocument['type'],
        body: content.body,
        media: content.media,
        poll: content.poll,
        sticker: content.sticker,
        event: content.event,
        forwarded: { isForwarded: true },
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: now,
      };

      await collection.insertOne(messageDoc);
      await unarchiveChatForParticipants(chat._id, chat.participants);
      await db.collection('chats').updateOne(
        { _id: chat._id },
        {
          $set: {
            lastMessageRef: {
              messageId: messageDoc._id,
              body: messageDoc.body,
              senderId: messageDoc.senderId,
              createdAt: messageDoc.createdAt,
            },
            updatedAt: now,
          },
        }
      );

      createdMessages.push(messageDoc);

      try {
        const apiMessage = serializeMessage(messageDoc, undefined, userObjectId);
        await getPubSub().publish(createEvent<MessageSentEvent>(EventType.MESSAGE_SENT, {
          messageId: messageDoc._id.toString(),
          chatId: chat._id.toString(),
          senderId: userId,
          senderName,
          content: messageDoc.body,
          mediaUrl: messageDoc.media?.url,
          mediaType: messageDoc.media?.type,
          chatType: chat.type,
          participants: chat.participants.map((participantId) => participantId.toString()),
          message: apiMessage,
          createdAt: messageDoc.createdAt.toISOString(),
        }));
      } catch (error) {
        logger.error({ error, messageId: messageDoc._id.toString() }, 'Failed to publish forwarded message');
      }
    }

    res.status(201).json({ messages: createdMessages.map((message) => serializeMessage(message, undefined, userObjectId)) });
  } catch (error) {
    next(error);
  }
}
