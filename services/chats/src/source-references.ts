import { ObjectId } from 'mongodb';
import type { SourceReference } from '@repo/types';
import { getDatabase } from './db';

interface SourceMessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  body?: string;
  type?: string;
  media?: {
    type?: string;
    fileName?: string;
  };
  poll?: {
    question?: string;
    options?: Array<{ text?: string }>;
  };
  event?: {
    title?: string;
    startAt?: Date;
    startsAt?: string;
    location?: string;
  };
  planThis?: {
    title?: string;
    status?: string;
    kind?: string;
  };
  deletedFor?: ObjectId[];
  createdAt: Date;
}

interface SourceUserDocument {
  _id: ObjectId;
  username?: string;
  name?: string;
}

function displayName(user: SourceUserDocument | undefined, fallbackId: string) {
  return user?.name || user?.username || fallbackId;
}

function makeSnippet(message: SourceMessageDocument) {
  const normalized = (message.body || '').replace(/\s+/g, ' ').trim();
  const fallback = [
    message.poll?.question ? `Poll: ${message.poll.question}` : null,
    message.event?.title
      ? `Event: ${message.event.title}${message.event.startAt ? ` at ${message.event.startAt.toISOString()}` : message.event.startsAt ? ` at ${message.event.startsAt}` : ''}`
      : null,
    message.planThis?.title ? `Plan This ${message.planThis.status || message.planThis.kind || 'card'}: ${message.planThis.title}` : null,
    message.media ? `${message.media.type || message.type || 'Attachment'}${message.media.fileName ? `: ${message.media.fileName}` : ''}` : null,
  ].find(Boolean);
  const text = normalized || fallback || '';
  if (text) return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
  const type = message.type;
  if (type && type !== 'text') return `[${type} message]`;
  return '[message]';
}

function uniqueValidIds(ids: Array<string | ObjectId | undefined | null>) {
  const seen = new Set<string>();
  const result: ObjectId[] = [];
  for (const value of ids) {
    const id = typeof value === 'string' ? value : value?.toString();
    if (!id || !ObjectId.isValid(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(new ObjectId(id));
  }
  return result;
}

export async function buildSourceReferences({
  chatId,
  userId,
  messageIds,
  label,
}: {
  chatId: ObjectId;
  userId: ObjectId;
  messageIds: Array<string | ObjectId | undefined | null>;
  label?: string;
}): Promise<SourceReference[]> {
  const sourceIds = uniqueValidIds(messageIds);
  if (sourceIds.length === 0) return [];

  const messages = await getDatabase()
    .collection<SourceMessageDocument>('messages')
    .find({
      _id: { $in: sourceIds },
      chatId,
      deletedFor: { $ne: userId },
      'momentReply.isMomentReply': { $ne: true },
    })
    .project<SourceMessageDocument>({
      _id: 1,
      chatId: 1,
      senderId: 1,
      body: 1,
      type: 1,
      media: 1,
      poll: 1,
      event: 1,
      planThis: 1,
      createdAt: 1,
    })
    .toArray();

  if (messages.length === 0) return [];

  const senderIds = Array.from(new Set(messages.map((message) => message.senderId.toString()))).map(
    (id) => new ObjectId(id)
  );
  const users = await getDatabase()
    .collection<SourceUserDocument>('users')
    .find({ _id: { $in: senderIds } })
    .project<SourceUserDocument>({ _id: 1, username: 1, name: 1 })
    .toArray();
  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const order = new Map(sourceIds.map((id, index) => [id.toString(), index]));

  return messages
    .sort((a, b) => (order.get(a._id.toString()) ?? 0) - (order.get(b._id.toString()) ?? 0))
    .map((message) => {
      const senderId = message.senderId.toString();
      return {
        messageId: message._id.toString(),
        chatId: message.chatId.toString(),
        senderId,
        senderDisplayName: displayName(userById.get(senderId), senderId),
        createdAt: message.createdAt.toISOString(),
        snippet: makeSnippet(message),
        label,
      };
    });
}

export async function buildSourceReferenceMap({
  chatId,
  userId,
  messageIds,
}: {
  chatId: ObjectId;
  userId: ObjectId;
  messageIds: Array<string | ObjectId | undefined | null>;
}) {
  const refs = await buildSourceReferences({ chatId, userId, messageIds });
  return new Map(refs.map((ref) => [ref.messageId, ref]));
}

export function refsForIds(
  refsByMessageId: Map<string, SourceReference>,
  ids: Array<string | ObjectId | undefined | null>,
  label?: string
) {
  const refs: SourceReference[] = [];
  const seen = new Set<string>();
  for (const value of ids) {
    const id = typeof value === 'string' ? value : value?.toString();
    if (!id || seen.has(id)) continue;
    const ref = refsByMessageId.get(id);
    if (!ref) continue;
    refs.push(label ? { ...ref, label } : ref);
    seen.add(id);
  }
  return refs;
}
