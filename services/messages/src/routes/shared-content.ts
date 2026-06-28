import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getMessagesCollection, MessageDocument } from '../models/message';
import { assertChatMembership, assertChatWritable } from '../chat-access';
import { attachmentLabel, getUserDisplayNames, inferMessageType, messageSnippet } from '../message-preview';
import { getDatabase } from '../db';

type SharedContentItem = Record<string, unknown>;

const SAFE_URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = /[),.!?:;]+$/;
const MAX_LINKS_PER_MESSAGE = 6;

const QuerySchema = z.object({
  chatId: z.string(),
  type: z.enum(['media', 'documents', 'links']),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = value ? parseInt(value, 10) : 30;
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 30;
    }),
});

function encodeCursor(message: MessageDocument) {
  return Buffer.from(
    JSON.stringify({ createdAt: message.createdAt.toISOString(), _id: message._id.toString() })
  ).toString('base64');
}

function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  if (!decoded.createdAt || !ObjectId.isValid(decoded._id)) {
    throw new Error('Invalid cursor');
  }
  const createdAt = new Date(decoded.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('Invalid cursor');
  }
  return { createdAt, _id: new ObjectId(decoded._id) };
}

function stripTrailingUrlPunctuation(url: string) {
  const trailing = url.match(TRAILING_URL_PUNCTUATION)?.[0] || '';
  return trailing ? url.slice(0, -trailing.length) : url;
}

function extractSafeLinks(text: string) {
  const links: Array<{ url: string; hostname: string }> = [];
  const seen = new Set<string>();
  const matches = text.match(SAFE_URL_REGEX) || [];

  for (const raw of matches) {
    const url = stripTrailingUrlPunctuation(raw);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push({ url: normalized, hostname: parsed.hostname });
    } catch {
      continue;
    }
    if (links.length >= MAX_LINKS_PER_MESSAGE) break;
  }

  return links;
}

function mediaKind(type: 'media' | 'documents' | 'links') {
  if (type === 'media') return 'image';
  if (type === 'documents') return 'document';
  return undefined;
}

function serializeBase(message: MessageDocument, senderName: string) {
  const snippet = messageSnippet(message, undefined, 140)
    .replace(/\b(?:javascript|data|vbscript):[^\s]*/gi, '[removed link]')
    .trim();
  return {
    messageId: message._id.toString(),
    chatId: message.chatId.toString(),
    senderDisplayName: senderName,
    createdAt: message.createdAt,
    messageType: inferMessageType(message),
    snippet,
    source: {
      chatId: message.chatId.toString(),
      messageId: message._id.toString(),
    },
  };
}

export async function listSharedContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const query = QuerySchema.safeParse(req.query);
    if (!query.success || !ObjectId.isValid(query.data.chatId)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid shared content query' });
      return;
    }

    let cursor: { createdAt: Date; _id: ObjectId } | null = null;
    try {
      cursor = decodeCursor(query.data.cursor);
    } catch {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid cursor' });
      return;
    }

    const userObjectId = new ObjectId(userId);
    const chatObjectId = new ObjectId(query.data.chatId);
    const chat = await assertChatMembership(chatObjectId, userObjectId);
    await assertChatWritable(chat);

    const dbQuery: any = {
      chatId: chatObjectId,
      deletedFor: { $ne: userObjectId },
    };

    const kind = mediaKind(query.data.type);
    if (kind) {
      dbQuery['media.type'] = kind;
    } else {
      dbQuery.body = { $regex: /\bhttps?:\/\/[^\s<>"']+/i };
    }

    if (cursor) {
      dbQuery.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
      ];
    }

    const messages = await getMessagesCollection()
      .find(dbQuery)
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.data.limit + 1)
      .toArray();

    let pageMessages = messages.slice(0, query.data.limit);
    if (kind) {
      const mediaIds = pageMessages
        .map((message) => message.media?.mediaId)
        .filter((mediaId): mediaId is ObjectId => mediaId instanceof ObjectId);
      const approvedIds = new Set(
        (
          await getDatabase()
            .collection('media')
            .find({ _id: { $in: mediaIds }, status: 'approved' }, { projection: { _id: 1 } })
            .toArray()
        ).map((media) => media._id.toString())
      );
      pageMessages = pageMessages.filter((message) => {
        const mediaId = message.media?.mediaId;
        return mediaId instanceof ObjectId && approvedIds.has(mediaId.toString());
      });
    }
    const names = await getUserDisplayNames(pageMessages.map((message) => message.senderId));

    const items: SharedContentItem[] = pageMessages.flatMap((message): SharedContentItem[] => {
      const base = serializeBase(message, names.get(message.senderId.toString()) || 'Someone');
      if (query.data.type === 'links') {
        return extractSafeLinks(message.body).map((link, index) => ({
          id: `${message._id.toString()}:${index}`,
          ...base,
          kind: 'link' as const,
          link,
        }));
      }

      return [
        {
          id: message._id.toString(),
          ...base,
          kind: query.data.type === 'media' ? ('media' as const) : ('document' as const),
          attachment: message.media
            ? {
                type: message.media.type,
                url: message.media.url,
                thumbnailUrl: message.media.thumbnailUrl,
                fileName: message.media.fileName,
                mimeType: message.media.mimeType,
                size: message.media.size,
                label: attachmentLabel(message),
                available: Boolean(message.media.url),
              }
            : {
                type: kind,
                available: false,
                label: 'File unavailable',
              },
        },
      ];
    });

    const hasMore = messages.length > query.data.limit;
    const last = pageMessages[pageMessages.length - 1];
    res.status(200).json({
      items,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  } catch (error) {
    next(error);
  }
}
