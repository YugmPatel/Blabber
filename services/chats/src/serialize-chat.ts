import type { ObjectId } from 'mongodb';
import { getDatabase } from './db';
import type { Chat } from './models/chat';

interface UserDocument {
  _id: ObjectId;
  name?: string;
  username?: string;
  email?: string;
  profileHandle?: string;
  displayHandle?: string;
  avatarUrl?: string;
}

function objectIdToString(id: ObjectId | string) {
  return typeof id === 'string' ? id : id.toString();
}

function displayName(user: UserDocument) {
  return user.name || user.username || user.email || user._id.toString();
}

export function isChatExpired(chat: Pick<Chat, 'groupKind' | 'expiresAt' | 'endedAt' | 'deletedAt'>, now = new Date()) {
  return Boolean(chat.deletedAt || chat.endedAt || (chat.groupKind === 'temporary' && chat.expiresAt && chat.expiresAt <= now));
}

export async function markExpiredIfNeeded(chat: Chat): Promise<Chat> {
  if (chat.groupKind !== 'temporary' || !chat.expiresAt || chat.endedAt || chat.deletedAt || chat.expiresAt > new Date()) {
    return chat;
  }

  const endedAt = new Date();
  const shouldDelete = chat.temporaryCompletionBehavior === 'end_and_delete';
  const set: Partial<Chat> = shouldDelete
    ? { endedAt, deletedAt: endedAt, updatedAt: endedAt }
    : { endedAt, updatedAt: endedAt };
  await getDatabase().collection<Chat>('chats').updateOne(
    { _id: chat._id, endedAt: { $exists: false }, deletedAt: { $exists: false } },
    { $set: set }
  );
  return { ...chat, ...set };
}

export async function serializeChat(
  chat: Chat,
  options: { includeParticipants?: boolean; viewerId?: ObjectId } = {}
) {
  const activeChat = await markExpiredIfNeeded(chat);
  const serialized: any = {
    _id: activeChat._id.toString(),
    type: activeChat.type,
    participants: activeChat.participants.map((id) => id.toString()),
    admins: activeChat.admins.map((id) => id.toString()),
    createdAt: activeChat.createdAt,
    updatedAt: activeChat.updatedAt,
  };

  const ownerId = activeChat.ownerId || activeChat.admins[0];
  if (ownerId) serialized.ownerId = ownerId.toString();
  if (activeChat.title) serialized.title = activeChat.title;
  if (activeChat.description || activeChat.groupContext) {
    serialized.description = activeChat.description || activeChat.groupContext;
  }
  if (activeChat.groupContext) serialized.groupContext = activeChat.groupContext;
  if (activeChat.avatarUrl) serialized.avatarUrl = activeChat.avatarUrl;
  if (activeChat.groupKind) serialized.groupKind = activeChat.groupKind;
  if (activeChat.temporaryCompletionBehavior) {
    serialized.temporaryCompletionBehavior = activeChat.temporaryCompletionBehavior;
  }
  serialized.sendMode = activeChat.sendMode || 'everyone';
  serialized.aiEnabled = activeChat.aiEnabled !== false;
  serialized.memberRestrictions = (activeChat.memberRestrictions || []).map((restriction) => ({
    userId: restriction.userId.toString(),
    restrictedBy: restriction.restrictedBy.toString(),
    restrictedAt: restriction.restrictedAt,
  }));
  if (activeChat.expiresAt) serialized.expiresAt = activeChat.expiresAt;
  if (activeChat.endedAt) serialized.endedAt = activeChat.endedAt;
  if (activeChat.deletedAt) serialized.deletedAt = activeChat.deletedAt;

  if (activeChat.lastMessageRef) {
    serialized.lastMessageRef = {
      messageId: objectIdToString(activeChat.lastMessageRef.messageId),
      body: activeChat.lastMessageRef.body,
      senderId: objectIdToString(activeChat.lastMessageRef.senderId),
      createdAt: activeChat.lastMessageRef.createdAt,
    };
  }

  // Group chats aren't subject to 1:1 block rules, so canMessage/blockedState
  // are only meaningful (and only ever set) for direct chats. Direction is
  // only revealed when the viewer is the blocker ('blocked_by_me') — the
  // reverse case collapses to the generic 'blocked' so the frontend can
  // never learn that the other participant specifically blocked them.
  if (activeChat.type === 'direct' && options.viewerId) {
    const otherParticipantId = activeChat.participants.find((id) => !id.equals(options.viewerId!));
    if (otherParticipantId) {
      const block = await getDatabase().collection('user_blocks').findOne({
        $or: [
          { blockerUserId: options.viewerId, blockedUserId: otherParticipantId },
          { blockerUserId: otherParticipantId, blockedUserId: options.viewerId },
        ],
      });
      if (!block) {
        serialized.blockedState = 'none';
        serialized.canMessage = true;
      } else if (block.blockerUserId.equals(options.viewerId)) {
        serialized.blockedState = 'blocked_by_me';
        serialized.canMessage = false;
      } else {
        serialized.blockedState = 'blocked';
        serialized.canMessage = false;
      }
    } else {
      serialized.blockedState = 'none';
      serialized.canMessage = true;
    }
  }

  if (options.includeParticipants) {
    const users = await getDatabase()
      .collection<UserDocument>('users')
      .find({ _id: { $in: activeChat.participants } })
      .project<UserDocument>({ _id: 1, name: 1, username: 1, email: 1, profileHandle: 1, displayHandle: 1, avatarUrl: 1 })
      .toArray();
    const byId = new Map(users.map((user) => [user._id.toString(), user]));
    serialized.participantProfiles = activeChat.participants.map((participantId) => {
      const id = participantId.toString();
      const user = byId.get(id);
      return user
        ? {
            _id: id,
            name: displayName(user),
            username: user.username,
            email: user.email,
            profileHandle: user.profileHandle,
            displayHandle: user.displayHandle || (user.profileHandle ? `@${user.profileHandle.replace(/^@/, '')}` : undefined),
            avatarUrl: user.avatarUrl,
          }
        : { _id: id, name: id };
    });
  }

  return serialized;
}
