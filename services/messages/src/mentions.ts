import { ObjectId } from 'mongodb';
import { getDatabase } from './db';
import type { MessageDocument } from './models/message';

export interface MentionInput {
  userId: string;
  start: number;
  length: number;
}

interface ChatLike {
  type?: 'direct' | 'group';
  participants: ObjectId[];
}

function displayName(user: any) {
  return user?.name || user?.username || 'Member';
}

export async function validateMentions(
  chat: ChatLike,
  body: string,
  mentions?: MentionInput[]
): Promise<MessageDocument['mentions']> {
  if (!mentions?.length) return undefined;
  if (chat.type !== 'group') {
    throw Object.assign(new Error('Mentions are only supported in group chats'), { statusCode: 400 });
  }

  const participantIds = new Map(chat.participants.map((id) => [id.toString(), id]));
  const unique = new Map<string, MentionInput>();
  for (const mention of mentions) {
    if (!ObjectId.isValid(mention.userId) || !participantIds.has(mention.userId)) {
      throw Object.assign(new Error('Mentioned user is not a current group participant'), { statusCode: 400 });
    }
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.length) || mention.start < 0 || mention.length <= 1) {
      throw Object.assign(new Error('Invalid mention range'), { statusCode: 400 });
    }
    if (mention.start + mention.length > body.length || body[mention.start] !== '@') {
      throw Object.assign(new Error('Mention range does not match message text'), { statusCode: 400 });
    }
    const text = body.slice(mention.start, mention.start + mention.length);
    if (!/^@[^\s@]{1,80}(?: [^\s@]{1,80}){0,4}$/.test(text)) {
      throw Object.assign(new Error('Mention text is invalid'), { statusCode: 400 });
    }
    unique.set(mention.userId, mention);
  }

  const ids = Array.from(unique.keys()).map((id) => new ObjectId(id));
  const users = await getDatabase()
    .collection('users')
    .find({ _id: { $in: ids } }, { projection: { name: 1, username: 1 } })
    .toArray();
  const byId = new Map(users.map((user) => [user._id.toString(), user]));

  return Array.from(unique.values()).map((mention) => ({
    userId: participantIds.get(mention.userId)!,
    start: mention.start,
    length: mention.length,
    displayName: displayName(byId.get(mention.userId)),
  }));
}

export function newlyMentionedUserIds(
  previous: MessageDocument['mentions'] | undefined,
  next: MessageDocument['mentions'] | undefined
) {
  const previousIds = new Set((previous || []).map((mention) => mention.userId.toString()));
  return (next || [])
    .map((mention) => mention.userId.toString())
    .filter((userId) => !previousIds.has(userId));
}
