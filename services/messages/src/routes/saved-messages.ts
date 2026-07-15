import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getMessagesCollection } from '../models/message';
import { getSavedMessagesCollection } from '../models/saved-message';
import { assertChatMembership } from '../chat-access';
import { attachmentLabel, getUserDisplayNames, inferMessageType, messageSnippet } from '../message-preview';
import { getDatabase } from '../db';

function serializeSave(save: any, message: any | null, senderName?: string, chatTitle?: string) {
  return {
    id: save._id?.toString(),
    userId: save.userId.toString(),
    chatId: save.chatId.toString(),
    messageId: save.messageId.toString(),
    savedAt: save.savedAt,
    available: Boolean(message),
    unavailableReason: message ? undefined : 'Original message unavailable',
    chatTitle,
    preview: message
      ? {
          senderId: message.senderId.toString(),
          senderDisplayName: senderName || 'Someone',
          type: inferMessageType(message),
	          snippet: messageSnippet(message, undefined, 180),
	          attachmentLabel: attachmentLabel(message),
	          media: message.media
	            ? {
	                type: message.media.type,
	                url: message.media.url,
	                thumbnailUrl: message.media.thumbnailUrl,
	                fileName: message.media.fileName,
	                mimeType: message.media.mimeType,
	                size: message.media.size,
	              }
	            : undefined,
	          createdAt: message.createdAt,
	        }
      : undefined,
  };
}

export async function listSavedMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }
    const userObjectId = new ObjectId(userId);
    const saves = await getSavedMessagesCollection().find({ userId: userObjectId }).sort({ savedAt: -1 }).limit(100).toArray();
    const messages = await getMessagesCollection()
      .find({ _id: { $in: saves.map((save) => save.messageId) }, deletedFor: { $ne: userObjectId } })
      .toArray();
    const messagesById = new Map(messages.map((message) => [message._id.toString(), message]));
    const accessibleMessages = [];
    for (const message of messages) {
      try {
        await assertChatMembership(message.chatId, userObjectId);
        accessibleMessages.push(message);
      } catch {
        messagesById.delete(message._id.toString());
      }
    }
    const names = await getUserDisplayNames(accessibleMessages.map((message) => message.senderId));
    const chats = await getDatabase().collection('chats').find({ _id: { $in: saves.map((save) => save.chatId) } }, { projection: { title: 1, type: 1 } }).toArray();
    const chatTitles = new Map(chats.map((chat) => [chat._id.toString(), chat.title || (chat.type === 'group' ? 'Group chat' : 'Direct chat')]));
    res.status(200).json({
      savedMessages: saves.map((save) => {
        const message = messagesById.get(save.messageId.toString()) || null;
        return serializeSave(save, message, message ? names.get(message.senderId.toString()) : undefined, chatTitles.get(save.chatId.toString()));
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function saveMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
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
    await assertChatMembership(message.chatId, userObjectId);
    const save = {
      userId: userObjectId,
      chatId: message.chatId,
      messageId: message._id,
      savedAt: new Date(),
    };
    await getSavedMessagesCollection().updateOne(
      { userId: userObjectId, messageId: message._id },
      { $setOnInsert: save },
      { upsert: true }
    );
    res.status(200).json({ saved: true });
  } catch (error) {
    next(error);
  }
}

export async function unsaveMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    if (!userId || !ObjectId.isValid(messageId)) {
      res.status(userId ? 400 : 401).json({ error: userId ? 'Bad Request' : 'Unauthorized', message: userId ? 'Invalid message ID' : 'User not authenticated' });
      return;
    }
    await getSavedMessagesCollection().deleteOne({ userId: new ObjectId(userId), messageId: new ObjectId(messageId) });
    res.status(200).json({ saved: false });
  } catch (error) {
    next(error);
  }
}
