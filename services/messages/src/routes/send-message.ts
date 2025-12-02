import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { CreateMessageDTOSchema, EventType, MessageSentEvent } from '@repo/types';
import { getMessagesCollection } from '../models/message';
import { getDatabase } from '../db';
import { logger, createEvent } from '@repo/utils';
import { getPubSub } from '../pubsub';

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

    const { body, mediaId, replyToId, tempId } = bodyResult.data;

    const collection = getMessagesCollection();
    const chatObjectId = new ObjectId(chatId);
    const senderObjectId = new ObjectId(userId);

    // Build message document
    const messageDoc: any = {
      _id: new ObjectId(),
      chatId: chatObjectId,
      senderId: senderObjectId,
      body,
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    };

    // Add media if provided
    if (mediaId) {
      // In a real implementation, we would fetch media details from media service
      // For now, we'll just store the mediaId reference
      // This would be enhanced to fetch actual media URL from media service
      messageDoc.media = {
        type: 'image', // This should come from media service
        url: `https://media.example.com/${mediaId}`, // This should come from media service
      };
    }

    // Add replyTo if provided
    if (replyToId) {
      if (!ObjectId.isValid(replyToId)) {
        res.status(400).json({ error: 'Bad Request', message: 'Invalid reply message ID' });
        return;
      }

      const replyToObjectId = new ObjectId(replyToId);
      const replyToMessage = await collection.findOne({ _id: replyToObjectId });

      if (!replyToMessage) {
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
    const db = getDatabase();
    const chatsCollection = db.collection('chats');
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

    // Transform to API format
    const apiMessage = {
      _id: messageDoc._id.toString(),
      chatId: messageDoc.chatId.toString(),
      senderId: messageDoc.senderId.toString(),
      body: messageDoc.body,
      media: messageDoc.media,
      replyTo: messageDoc.replyTo
        ? {
            messageId: messageDoc.replyTo.messageId.toString(),
            body: messageDoc.replyTo.body,
            senderId: messageDoc.replyTo.senderId.toString(),
          }
        : undefined,
      reactions: [],
      status: messageDoc.status,
      createdAt: messageDoc.createdAt,
      tempId, // Include tempId for optimistic updates
    };

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
        content: messageDoc.body,
        mediaUrl: messageDoc.media?.url,
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
