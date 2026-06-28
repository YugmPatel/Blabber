import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { EventType, MessagePinEvent } from '@repo/types';
import { createEvent, logger } from '@repo/utils';
import { getMessagesCollection } from '../models/message';
import { getMessagePinsCollection } from '../models/message-pin';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { attachmentLabel, getUserDisplayNames, inferMessageType, messageSnippet } from '../message-preview';
import { getPubSub } from '../pubsub';

const PIN_LIMIT = 5;

function canManagePins(chat: any, userId: ObjectId) {
  if (chat.type === 'direct') return true;
  return Boolean(
    chat.ownerId?.equals(userId) || chat.admins?.some((adminId: ObjectId) => adminId.equals(userId))
  );
}

function serializePin(pin: any) {
  return {
    id: pin._id?.toString(),
    chatId: pin.chatId.toString(),
    messageId: pin.messageId.toString(),
    pinnedBy: pin.pinnedBy.toString(),
    pinnedAt: pin.pinnedAt,
    preview: {
      ...pin.preview,
      senderId: pin.preview.senderId.toString(),
    },
  };
}

async function publishPin(type: EventType.MESSAGE_PINNED | EventType.MESSAGE_UNPINNED, chat: any, messageId: ObjectId, pinnedBy: string, pin?: any) {
  try {
    await getPubSub().publish(createEvent<MessagePinEvent>(type, {
      chatId: chat._id.toString(),
      messageId: messageId.toString(),
      pinnedBy,
      participants: chat.participants.map((id: ObjectId) => id.toString()),
      pin: pin ? serializePin(pin) : undefined,
    }));
  } catch (error) {
    logger.error({ error, messageId: messageId.toString() }, 'Failed to publish pin event');
  }
}

export async function listPins(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    if (!userId || !ObjectId.isValid(chatId)) {
      res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid chat ID' : 'User not authenticated' });
      return;
    }
    const chat = await assertChatMembership(new ObjectId(chatId), new ObjectId(userId));
    const pins = await getMessagePinsCollection().find({ chatId: chat._id }).sort({ pinnedAt: -1 }).toArray();
    res.status(200).json({ pins: pins.map(serializePin), canManagePins: canManagePins(chat, new ObjectId(userId)) });
  } catch (error) {
    next(error);
  }
}

export async function pinMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    if (!userId || !ObjectId.isValid(messageId)) {
      res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid message ID' : 'User not authenticated' });
      return;
    }

    const userObjectId = new ObjectId(userId);
    const message = await getMessagesCollection().findOne({ _id: new ObjectId(messageId), deletedFor: { $ne: userObjectId } });
    if (!message) {
      res.status(404).json({ error: 'Not Found', message: 'Message not found' });
      return;
    }
    const chat = await assertChatMembership(message.chatId, userObjectId);
    await assertChatWritable(chat);
    if (!canManagePins(chat, userObjectId)) {
      res.status(403).json({ error: 'Forbidden', message: 'You cannot pin messages in this chat' });
      return;
    }

    const pins = getMessagePinsCollection();
    if (await pins.findOne({ chatId: message.chatId, messageId: message._id })) {
      res.status(409).json({ error: 'Conflict', message: 'Message is already pinned' });
      return;
    }
    const count = await pins.countDocuments({ chatId: message.chatId });
    if (count >= PIN_LIMIT) {
      res.status(400).json({ error: 'Bad Request', message: `Chats can have up to ${PIN_LIMIT} pinned messages` });
      return;
    }

    const names = await getUserDisplayNames([message.senderId]);
    const now = new Date();
    const pin = {
      chatId: message.chatId,
      messageId: message._id,
      pinnedBy: userObjectId,
      pinnedAt: now,
      preview: {
        senderId: message.senderId,
        senderDisplayName: names.get(message.senderId.toString()) || 'Someone',
        type: inferMessageType(message),
        snippet: messageSnippet(message, undefined, 160),
        attachmentLabel: attachmentLabel(message),
        createdAt: message.createdAt,
      },
    };
    const result = await pins.insertOne(pin);
    const created = { ...pin, _id: result.insertedId };
    await publishPin(EventType.MESSAGE_PINNED, chat, message._id, userId, created);
    res.status(201).json({ pin: serializePin(created) });
  } catch (error) {
    next(error);
  }
}

export async function unpinMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    if (!userId || !ObjectId.isValid(messageId)) {
      res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid message ID' : 'User not authenticated' });
      return;
    }
    const userObjectId = new ObjectId(userId);
    const pin = await getMessagePinsCollection().findOne({ messageId: new ObjectId(messageId) });
    if (!pin) {
      res.status(404).json({ error: 'Not Found', message: 'Pin not found' });
      return;
    }
    const chat = await assertChatMembership(pin.chatId, userObjectId);
    await assertChatWritable(chat);
    if (!canManagePins(chat, userObjectId)) {
      res.status(403).json({ error: 'Forbidden', message: 'You cannot unpin messages in this chat' });
      return;
    }
    await getMessagePinsCollection().deleteOne({ _id: pin._id });
    await publishPin(EventType.MESSAGE_UNPINNED, chat, pin.messageId, userId);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}
