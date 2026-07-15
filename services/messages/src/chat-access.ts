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
  temporaryCompletionBehavior?: 'end_only' | 'end_and_delete';
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
    const set: Partial<ChatDocument> & { updatedAt: Date } =
      chat.temporaryCompletionBehavior === 'end_and_delete'
        ? { endedAt: now, deletedAt: now, updatedAt: now }
        : { endedAt: now, updatedAt: now };
    await getDatabase().collection<ChatDocument>('chats').updateOne(
      { _id: chat._id, endedAt: { $exists: false }, deletedAt: { $exists: false } },
      { $set: set }
    );
    Object.assign(chat, set);
  }

  return chat;
}

export async function assertChatWritable(
  chat: ChatDocument,
  userId?: ObjectId,
  options: { enforceSendMode?: boolean } = {}
): Promise<void> {
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
    // A per-user mute always applies regardless of the call site — unlike
    // admins-only mode below, it's a targeted moderation action, not a
    // blanket "new content" gate, so it also covers reactions/votes/RSVPs.
    const isRestricted = chat.memberRestrictions?.some((restriction) => restriction.userId.equals(userId));
    if (isRestricted) {
      throw new ForbiddenError('You cannot send messages in this group right now');
    }

    // admins_only restricts posting *new* content (messages, media, polls,
    // events, forwards). Interacting with content that already exists
    // (reacting, voting, RSVPing) is not "sending a message" in the way an
    // admin-only channel is meant to restrict, so those call sites pass
    // enforceSendMode: false to opt out of this specific check while still
    // going through every other guard above (ended/deleted/blocked/muted).
    const enforceSendMode = options.enforceSendMode !== false;
    if (enforceSendMode) {
      const isAdmin = chat.admins?.some((adminId) => adminId.equals(userId)) || chat.ownerId?.equals(userId);
      if (chat.sendMode === 'admins_only' && !isAdmin) {
        throw new ForbiddenError('Only group admins can send messages right now');
      }
    }
  }
}
