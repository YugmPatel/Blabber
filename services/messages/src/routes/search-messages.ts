import { Request, Response, NextFunction } from 'express';
import { Filter, ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDatabase } from '../db';
import { getMessagesCollection, MessageDocument } from '../models/message';
import { assertChatMembership } from '../chat-access';
import { attachmentLabel, getUserDisplayNames, inferMessageType, messageSnippet } from '../message-preview';
import { checkSearchRateLimit } from '../search-rate-limit';

const MESSAGE_TYPES = ['text', 'image', 'audio', 'document', 'poll', 'sticker', 'event'] as const;

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  chatId: z.string().optional(),
  type: z.enum(MESSAGE_TYPES).optional(),
  chatKind: z.enum(['direct', 'group']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

interface ChatDocument {
  _id: ObjectId;
  type?: 'direct' | 'group';
  participants: ObjectId[];
  groupKind?: 'standard' | 'temporary';
  expiresAt?: Date;
  endedAt?: Date;
  deletedAt?: Date;
}

function encodeCursor(message: MessageDocument) {
  return Buffer.from(JSON.stringify({
    createdAt: message.createdAt.toISOString(),
    id: message._id.toString(),
  })).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: ObjectId } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed.createdAt || !ObjectId.isValid(parsed.id)) return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: new ObjectId(parsed.id) };
  } catch {
    return null;
  }
}

function cursorFilter(cursor: { createdAt: Date; id: ObjectId } | null) {
  if (!cursor) return {};
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}

function activeChatFilter(now: Date): Filter<ChatDocument> {
  return {
    deletedAt: { $exists: false },
    endedAt: { $exists: false },
    $or: [
      { groupKind: { $ne: 'temporary' as const } },
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: now } },
    ],
  };
}

function resultFromMessage(
  message: MessageDocument,
  query: string,
  senderNames: Map<string, string>,
  chatKinds: Map<string, 'direct' | 'group' | undefined>
) {
  const type = inferMessageType(message);
  return {
    messageId: message._id.toString(),
    chatId: message.chatId.toString(),
    senderId: message.senderId.toString(),
    senderDisplayName: senderNames.get(message.senderId.toString()) || 'Someone',
    createdAt: message.createdAt.toISOString(),
    snippet: messageSnippet(message, query),
    type,
    attachmentLabel: attachmentLabel(message),
    chatKind: chatKinds.get(message.chatId.toString()),
  };
}

async function serializeResults(messages: MessageDocument[], query: string, chats: ChatDocument[]) {
  const senderNames = await getUserDisplayNames(messages.map((message) => message.senderId));
  const chatKinds = new Map(chats.map((chat) => [chat._id.toString(), chat.type]));
  return messages.map((message) => resultFromMessage(message, query, senderNames, chatKinds));
}

export async function searchMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    if (!checkSearchRateLimit(userId, 'chat')) {
      res.status(429).json({ error: 'Too Many Requests', message: 'Search rate limit exceeded' });
      return;
    }

    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success || !parsed.data.chatId || !ObjectId.isValid(parsed.data.chatId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid search query' });
      return;
    }

    const { q, chatId, type, cursor, limit } = parsed.data;
    const userObjectId = new ObjectId(userId);
    const chatObjectId = new ObjectId(chatId);
    const chat = await assertChatMembership(chatObjectId, userObjectId);
    const decodedCursor = decodeCursor(cursor);

    const collection = getMessagesCollection();
    const messages = await collection
      .find({
        chatId: chatObjectId,
        deletedFor: { $ne: userObjectId },
        $text: { $search: q },
        ...(type ? { type } : {}),
        ...cursorFilter(decodedCursor),
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const page = messages.slice(0, limit);
    res.status(200).json({
      results: await serializeResults(page, q, [chat]),
      nextCursor: messages.length > limit ? encodeCursor(page[page.length - 1]) : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function searchMessagesGlobal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    if (!checkSearchRateLimit(userId, 'global')) {
      res.status(429).json({ error: 'Too Many Requests', message: 'Search rate limit exceeded' });
      return;
    }

    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid search query' });
      return;
    }

    const { q, type, chatKind, cursor, limit } = parsed.data;
    const userObjectId = new ObjectId(userId);
    const chats = await getDatabase()
      .collection<ChatDocument>('chats')
      .find({
        participants: userObjectId,
        ...(chatKind ? { type: chatKind } : {}),
        ...activeChatFilter(new Date()),
      })
      .project<ChatDocument>({ _id: 1, type: 1, participants: 1 })
      .toArray();

    const chatIds = chats.map((chat) => chat._id);
    if (chatIds.length === 0) {
      res.status(200).json({ results: [], nextCursor: null });
      return;
    }

    const decodedCursor = decodeCursor(cursor);
    const messages = await getMessagesCollection()
      .find({
        chatId: { $in: chatIds },
        deletedFor: { $ne: userObjectId },
        $text: { $search: q },
        ...(type ? { type } : {}),
        ...cursorFilter(decodedCursor),
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const page = messages.slice(0, limit);
    res.status(200).json({
      results: await serializeResults(page, q, chats),
      nextCursor: messages.length > limit ? encodeCursor(page[page.length - 1]) : null,
    });
  } catch (error) {
    next(error);
  }
}
