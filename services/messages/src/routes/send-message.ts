import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { CreateMessageDTOSchema, EventType, MessageSentEvent } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { getDatabase } from '../db';
import { logger, createEvent } from '@repo/utils';
import { getPubSub } from '../pubsub';
import { serializeMessage } from '../serialize-message';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { buildReplyPreview } from '../message-preview';
import { validateMentions } from '../mentions';
import { unarchiveChatForParticipants } from '../chat-state';
import { parseEventDate, validateMeetingUrl, validateTimezone } from '../event-utils';
import { resolveShareablePost, resolveShareableReel } from '../shared-item-access';

function getMessageMediaType(fileType: string): 'image' | 'audio' | 'document' {
  if (fileType.startsWith('image/')) {
    return 'image';
  }

  if (fileType.startsWith('audio/')) {
    return 'audio';
  }

  return 'document';
}

const MESSAGE_TOTAL_ATTACHMENT_BYTES = Number(process.env.MEDIA_MESSAGE_TOTAL_BYTES || 30 * 1024 * 1024);
const MEDIA_UPLOAD_ERROR = 'This file could not be uploaded.';

function normalizedPollOption(option: string) {
  return option.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export async function sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { chatId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    // Validate chatId
    if (!ObjectId.isValid(chatId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid chat ID' });
      return;
    }

    // Validate request body
    const bodyResult = CreateMessageDTOSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: bodyResult.error.errors,
      });
      return;
    }

    const {
      body,
      type,
      mediaId,
      mediaDuration,
      poll,
      sticker,
      event,
      replyToId,
      sharedItem,
      mentions,
      tempId,
      clientMessageId,
    } = bodyResult.data;
    const stableClientMessageId = clientMessageId || tempId;

    const collection = getMessagesCollection();
    const db = getDatabase();
    const chatObjectId = new ObjectId(chatId);
    const senderObjectId = new ObjectId(userId);

    const chatAccess = await assertChatMembership(chatObjectId, senderObjectId);
    await assertChatWritable(chatAccess, senderObjectId);

    if (stableClientMessageId) {
      const existingMessage = await collection.findOne({
        chatId: chatObjectId,
        senderId: senderObjectId,
        clientMessageId: stableClientMessageId,
      });

      if (existingMessage) {
        res.status(200).json(serializeMessage(existingMessage, stableClientMessageId, senderObjectId));
        return;
      }
    }

    // Build message document
    const messageDoc: any = {
      _id: new ObjectId(),
      chatId: chatObjectId,
      senderId: senderObjectId,
      type: type ?? 'text',
      body,
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    };

    if (stableClientMessageId) {
      messageDoc.clientMessageId = stableClientMessageId;
    }

    // Add media if provided
    if (mediaId) {
      if (!ObjectId.isValid(mediaId)) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid media ID' });
        return;
      }

      const mediaDoc = await db.collection('media').findOne({
        _id: new ObjectId(mediaId),
        userId: senderObjectId,
        status: 'approved',
      });

      if (!mediaDoc?.url || !mediaDoc?.fileType) {
        res.status(404).json({ error: 'Not Found', message: MEDIA_UPLOAD_ERROR });
        return;
      }

      if ((mediaDoc.storage === 'local' && !mediaDoc.uploadedAt) || mediaDoc.fileSize > MESSAGE_TOTAL_ATTACHMENT_BYTES) {
        res.status(400).json({
          error: 'Bad Request',
          message: MEDIA_UPLOAD_ERROR,
        });
        return;
      }

      messageDoc.media = {
        type: getMessageMediaType(mediaDoc.fileType),
        url: mediaDoc.url,
        mediaId: mediaDoc._id,
        storageKey: mediaDoc.s3Key,
        fileName: mediaDoc.fileName,
        mimeType: mediaDoc.fileType,
        size: mediaDoc.fileSize,
        duration: mediaDuration,
      };
      messageDoc.type = messageDoc.media.type;
    }

    if (poll) {
      const closesAt = poll.closesAt ? new Date(poll.closesAt) : undefined;
      if (closesAt && closesAt.getTime() <= Date.now()) {
        res.status(400).json({ error: 'Bad Request', message: 'Poll close time must be in the future' });
        return;
      }

      const normalizedOptions = poll.options.map(normalizedPollOption);
      if (new Set(normalizedOptions).size !== normalizedOptions.length) {
        res.status(400).json({ error: 'Bad Request', message: 'Poll options must be unique' });
        return;
      }

      messageDoc.type = 'poll';
      messageDoc.poll = {
        question: poll.question,
        options: poll.options.map((option, index) => ({
          id: `option-${index + 1}`,
          text: option,
          votes: [],
        })),
        allowMultiple: poll.allowMultiple ?? false,
        allowVoteChanges: poll.allowVoteChanges ?? true,
        showVoters: poll.showVoters ?? false,
        closesAt,
        createdBy: senderObjectId,
        votes: [],
        closed: false,
      };
    }

    if (sticker) {
      messageDoc.type = 'sticker';
      messageDoc.sticker = sticker;
    }

    if (event) {
      const startAt = parseEventDate(event.startAt || event.startsAt);
      const endAt = parseEventDate(event.endAt);
      const timezone = validateTimezone(event.timezone);
      const meetingUrl = validateMeetingUrl(event.meetingUrl);

      if (!startAt) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid event start time' });
        return;
      }

      if (endAt && endAt.getTime() <= startAt.getTime()) {
        res.status(400).json({ error: 'Bad Request', message: 'Event end time must be after start time' });
        return;
      }

      if (!timezone) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid event timezone' });
        return;
      }

      if (meetingUrl === null) {
        res.status(400).json({ error: 'Bad Request', message: 'Meeting URL must use http or https' });
        return;
      }

      messageDoc.type = 'event';
      messageDoc.event = {
        ...event,
        startsAt: startAt.toISOString(),
        startAt,
        endAt: endAt || undefined,
        timezone,
        meetingUrl: typeof meetingUrl === 'string' ? meetingUrl : undefined,
        createdBy: senderObjectId,
        updatedAt: new Date(),
        reminderEnabled: event.reminderEnabled ?? true,
        rsvps: [
          {
            userId: senderObjectId,
            status: 'going',
            respondedAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };
    }

    if (sharedItem) {
      if (!ObjectId.isValid(sharedItem.id)) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid shared item ID' });
        return;
      }
      const sharedObjectId = new ObjectId(sharedItem.id);
      const resolved =
        sharedItem.type === 'post'
          ? await resolveShareablePost(sharedObjectId, senderObjectId)
          : await resolveShareableReel(sharedObjectId, senderObjectId);

      if (!resolved) {
        res.status(403).json({
          error: 'Forbidden',
          message: `This ${sharedItem.type} is not available to share.`,
        });
        return;
      }

      messageDoc.sharedItem = {
        type: sharedItem.type,
        id: sharedObjectId,
        url: sharedItem.type === 'post' ? `/feed?post=${sharedItem.id}` : `/reels/${sharedItem.id}`,
        text: resolved.text,
        authorName: resolved.authorName,
        thumbnailUrl: resolved.thumbnailUrl,
        createdAt: resolved.createdAt,
      };
    }

    if (mentions?.length) {
      messageDoc.mentions = await validateMentions(chatAccess, body, mentions);
    }

    // Add replyTo if provided
    if (replyToId) {
      if (!ObjectId.isValid(replyToId)) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid reply message ID' });
        return;
      }

      const replyToObjectId = new ObjectId(replyToId);
      const replyToMessage = await collection.findOne({
        _id: replyToObjectId,
        deletedFor: { $ne: senderObjectId },
      });

      if (!replyToMessage || !replyToMessage.chatId.equals(chatObjectId)) {
        res.status(404).json({ error: 'Not Found', message: 'Reply message not found' });
        return;
      }

      messageDoc.replyTo = await buildReplyPreview(replyToMessage);
    }

    // Insert message
    await collection.insertOne(messageDoc);

    // Update chat's lastMessageRef
    const chatsCollection = db.collection('chats');
    const chatDoc = await chatsCollection.findOne({ _id: chatObjectId });
    if (chatDoc?.participants?.length) {
      await unarchiveChatForParticipants(chatObjectId, chatDoc.participants);
    }
    await chatsCollection.updateOne(
      { _id: chatObjectId },
      {
        $set: {
          lastMessageRef: {
            messageId: messageDoc._id,
            body: messageDoc.body,
            senderId: messageDoc.senderId,
            createdAt: messageDoc.createdAt,
          },
          updatedAt: new Date(),
        },
      }
    );

    const apiMessage = serializeMessage(messageDoc, stableClientMessageId, senderObjectId);
    const sender = await db.collection('users').findOne(
      { _id: senderObjectId },
      { projection: { name: 1, username: 1 } }
    );
    const senderName = sender?.name || sender?.username || 'Someone';

    logger.info(
      {
        messageId: messageDoc._id.toString(),
        chatId,
        userId,
      },
      'Message sent'
    );

    // Publish event to Redis for real-time delivery
    try {
      const pubsub = getPubSub();
      const event = createEvent<MessageSentEvent>(EventType.MESSAGE_SENT, {
        messageId: messageDoc._id.toString(),
        chatId: chatId,
        senderId: userId,
        senderName,
        clientMessageId: stableClientMessageId,
        content: messageDoc.body,
        mediaUrl: messageDoc.media?.url,
        mediaType: messageDoc.media?.type,
        chatType: chatDoc?.type,
        chatTitle: chatDoc?.title,
        participants: chatDoc?.participants?.map((participantId: ObjectId) => participantId.toString()),
        message: apiMessage,
        replyTo: messageDoc.replyTo?.messageId.toString(),
        mentions: apiMessage.mentions,
        createdAt: messageDoc.createdAt.toISOString(),
      });
      await pubsub.publish(event);
      logger.debug({ messageId: messageDoc._id.toString() }, 'Published MESSAGE_SENT event');
    } catch (error) {
      // Don't fail the request if event publishing fails
      logger.error(
        { error, messageId: messageDoc._id.toString() },
        'Failed to publish MESSAGE_SENT event'
      );
    }

    res.status(201).json(apiMessage);
  } catch (error) {
    logger.error({ error, chatId: req.params.chatId }, 'Failed to send message');
    next(error);
  }
}
