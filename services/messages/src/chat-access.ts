import { ObjectId } from 'mongodb';
import { ForbiddenError, NotFoundError } from '@repo/utils';
import { getDatabase } from './db';

interface ChatDocument {
  _id: ObjectId;
  type?: 'direct' | 'group';
  participants: ObjectId[];
  admins?: ObjectId[];
  ownerId?: ObjectId;
  sendMode?: 'everyone' | 'admins_only';
  memberRestrictions?: {
    userId: ObjectId;
    restrictedBy: ObjectId;
    restrictedAt: Date;
  }[];
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

export async function assertChatWritable(chat: ChatDocument, userId?: ObjectId): Promise<void> {
  if (chat.deletedAt) {
    throw new NotFoundError('Chat not found');
  }
  if (chat.endedAt || (chat.groupKind === 'temporary' && chat.expiresAt && chat.expiresAt <= new Date())) {
    throw new ForbiddenError('This temporary group has ended');
  }

  if (!userId) return;

  if (chat.type === 'direct') {
    const otherParticipantId = chat.participants.find((participantId) => !participantId.equals(userId));
    if (!otherParticipantId) return;
    const block = await getDatabase().collection('user_blocks').findOne({
      $or: [
        { blockerUserId: userId, blockedUserId: otherParticipantId },
        { blockerUserId: otherParticipantId, blockedUserId: userId },
      ],
    });
    if (block) {
      throw new ForbiddenError('Direct messaging is unavailable');
    }
  }

  if (chat.type === 'group') {
    const isRestricted = chat.memberRestrictions?.some((restriction) => restriction.userId.equals(userId));
    if (isRestricted) {
      throw new ForbiddenError('You cannot send messages in this group right now');
    }

    const isAdmin = chat.admins?.some((adminId) => adminId.equals(userId)) || chat.ownerId?.equals(userId);
    if (chat.sendMode === 'admins_only' && !isAdmin) {
      throw new ForbiddenError('Only group admins can send messages right now');
    }
  }
}
