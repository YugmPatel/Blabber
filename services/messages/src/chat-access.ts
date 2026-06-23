import { ObjectId } from 'mongodb';
import { ForbiddenError, NotFoundError } from '@repo/utils';
import { getDatabase } from './db';

interface ChatDocument {
  _id: ObjectId;
  type?: 'direct' | 'group';
  participants: ObjectId[];
  groupKind?: 'standard' | 'temporary';
  expiresAt?: Date;
  endedAt?: Date;
  deletedAt?: Date;
}

export async function assertChatMembership(chatId: ObjectId, userId: ObjectId): Promise<ChatDocument> {
  const chat = await getDatabase().collection<ChatDocument>('chats').findOne({ _id: chatId });

  if (!chat) {
    throw new NotFoundError('Chat not found');
  }

  if (chat.deletedAt) {
    throw new NotFoundError('Chat not found');
  }

  const isParticipant = chat.participants.some((participantId) => participantId.equals(userId));
  if (!isParticipant) {
    throw new ForbiddenError('You are not a member of this chat');
  }

  const now = new Date();
  if (chat.groupKind === 'temporary' && chat.expiresAt && chat.expiresAt <= now && !chat.endedAt) {
    await getDatabase().collection<ChatDocument>('chats').updateOne(
      { _id: chat._id, endedAt: { $exists: false } },
      { $set: { endedAt: now, updatedAt: now } }
    );
    chat.endedAt = now;
  }

  return chat;
}

export function assertChatWritable(chat: ChatDocument): void {
  if (chat.deletedAt) {
    throw new NotFoundError('Chat not found');
  }
  if (chat.endedAt || (chat.groupKind === 'temporary' && chat.expiresAt && chat.expiresAt <= new Date())) {
    throw new ForbiddenError('This temporary group has ended');
  }
}
