import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { CreateMessageDTOSchema, EventType, MessageSentEvent } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { getDatabase } from '../db';
import { logger, createEvent } from '@repo/utils';
import { getPubSub } from '../pubsub';
import { serializeMessage } from '../serialize-message';
import { assertChatMembership, assertChatWritable } from '../chat-access';

function getMessageMediaType(fileType: string): 'image' | 'audio' | 'document' {
  if (fileType.startsWith('image/')) {
    return 'image';
  }

  if (fileType.startsWith('audio/')) {
    return 'audio';
  }

  return 'document';
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

    const { body, type, mediaId, mediaDuration, poll, sticker, event, replyToId, tempId, clientMessageId } =
      bodyResult.data;
    const stableClientMessageId = clientMessageId || tempId;

    const collection = getMessagesCollection();
    const db = getDatabase();
    const chatObjectId = new ObjectId(chatId);
    const senderObjectId = new ObjectId(userId);

    const chatAccess = await assertChatMembership(chatObjectId, senderObjectId);
    assertChatWritable(chatAccess);

    if (stableClientMessageId) {
      const existingMessage = await collection.findOne({
        chatId: chatObjectId,
        senderId: senderObjectId,
        clientMessageId: stableClientMessageId,
      });

      if (existingMessage) {
        res.status(200).json(serializeMessage(existingMessage, stableClientMessageId));
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
      });

      if (!mediaDoc?.url || !mediaDoc?.fileType) {
        res.status(404).json({ error: 'Not Found', message: 'Media not found' });
        return;
      }

      if (mediaDoc.storage === 'local' && !mediaDoc.uploadedAt) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Media upload has not completed',
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
      messageDoc.type = 'poll';
      messageDoc.poll = {
        question: poll.question,
        options: poll.options.map((option, index) => ({
          id: `option-${index + 1}`,
          text: option,
          votes: [],
        })),
        allowMultiple: poll.allowMultiple ?? false,
        closed: false,
      };
    }

    if (sticker) {
      messageDoc.type = 'sticker';
      messageDoc.sticker = sticker;
    }

    if (event) {
      messageDoc.type = 'event';
      messageDoc.event = event;
    }

    // Add replyTo if provided
    if (replyToId) {
      if (!ObjectId.isValid(replyToId)) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid reply message ID' });
        return;
      }

      const replyToObjectId = new ObjectId(replyToId);
      const replyToMessage = await collection.findOne({ _id: replyToObjectId });

      if (!replyToMessage || !replyToMessage.chatId.equals(chatObjectId)) {
        res.status(404).json({ error: 'Not Found', message: 'Reply message not found' });
        return;
      }

      messageDoc.replyTo = {
        messageId: replyToMessage._id,
        body: replyToMessage.body,
        senderId: replyToMessage.senderId,
      };
    }

    // Insert message
    await collection.insertOne(messageDoc);

    // Update chat's lastMessageRef
    const chatsCollection = db.collection('chats');
    const chatDoc = await chatsCollection.findOne({ _id: chatObjectId });
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

    const apiMessage = serializeMessage(messageDoc, stableClientMessageId);
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
