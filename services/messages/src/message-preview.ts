import { ObjectId } from 'mongodb';
import { getDatabase } from './db';
import type { MessageDocument } from './models/message';

export function inferMessageType(message: Pick<MessageDocument, 'type' | 'poll' | 'sticker' | 'event' | 'media'>) {
  if (message.type) return message.type;
  if (message.poll) return 'poll';
  if (message.sticker) return 'sticker';
  if (message.event) return 'event';
  if (message.media) return message.media.type;
  return 'text';
}

export function attachmentLabel(message: MessageDocument): string | undefined {
  if (message.momentReply?.isMomentReply) return message.momentReply.label || 'Replied to a Moment';
  const type = inferMessageType(message);
  if (message.media?.fileName) return message.media.fileName;
  if (type === 'image') return 'Image';
  if (type === 'audio') return 'Audio';
  if (type === 'document') return 'Document';
  if (type === 'poll') return 'Poll';
  if (type === 'sticker') return message.sticker?.label || 'Sticker';
  if (type === 'event') return 'Event';
  return undefined;
}

export function searchableText(message: MessageDocument): string {
  return [
    message.body,
    message.media?.fileName,
    message.poll?.question,
    ...(message.poll?.options.map((option) => option.text) ?? []),
    message.sticker?.label,
    message.event?.title,
    message.event?.location,
    message.event?.description,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function messageSnippet(message: MessageDocument, query?: string, maxLength = 160): string {
  const text = searchableText(message) || attachmentLabel(message) || inferMessageType(message);
  if (text.length <= maxLength) return text;

  const q = query?.trim().toLowerCase();
  const index = q ? text.toLowerCase().indexOf(q) : -1;
  if (index <= 0) return `${text.slice(0, maxLength - 1).trim()}…`;

  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength - 1);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export async function getUserDisplayNames(userIds: ObjectId[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Map(userIds.map((id) => [id.toString(), id])).values());
  if (uniqueIds.length === 0) return new Map();

  const users = await getDatabase()
    .collection('users')
    .find({ _id: { $in: uniqueIds } }, { projection: { name: 1, username: 1, email: 1 } })
    .toArray();

  return new Map(
    users.map((user) => [
      user._id.toString(),
      user.name || user.username || user.email || 'Someone',
    ])
  );
}

export async function buildReplyPreview(message: MessageDocument) {
  const names = await getUserDisplayNames([message.senderId]);
  const snippet = messageSnippet(message, undefined, 120);

  return {
    messageId: message._id,
    body: snippet,
    senderId: message.senderId,
    senderDisplayName: names.get(message.senderId.toString()) || 'Someone',
    messageType: inferMessageType(message),
    snippet,
    attachmentLabel: attachmentLabel(message),
  };
}
