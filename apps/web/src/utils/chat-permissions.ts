import type { Chat } from '@repo/types';

/**
 * Mirrors services/chats's serialize-chat.ts#isChatExpired and
 * services/messages's chat-access.ts#assertChatWritable's ended-group
 * check. A group is ended once endedAt is set, or once a temporary group's
 * expiresAt has passed (the server lazily materializes endedAt the next
 * time the chat is read/written, but the client can derive the same result
 * immediately from expiresAt without waiting for that write).
 */
export function isChatEnded(chat: Pick<Chat, 'type' | 'groupKind' | 'expiresAt' | 'endedAt'>): boolean {
  if (chat.type !== 'group') return false;
  if (chat.endedAt) return true;
  if (chat.groupKind === 'temporary' && chat.expiresAt) {
    return new Date(chat.expiresAt).getTime() <= Date.now();
  }
  return false;
}

export function isGroupAdmin(chat: Pick<Chat, 'admins' | 'ownerId'>, userId?: string): boolean {
  if (!userId) return false;
  return Boolean(chat.admins?.includes(userId) || chat.ownerId === userId);
}

function isRestrictedMember(chat: Pick<Chat, 'memberRestrictions'>, userId?: string): boolean {
  if (!userId) return false;
  return Boolean(chat.memberRestrictions?.some((restriction) => restriction.userId === userId));
}

export type SendBlockedReason = 'ended' | 'admins_only' | 'restricted' | 'blocked' | null;

/**
 * Mirrors services/messages's chat-access.ts#assertChatWritable's priority
 * order (ended/deleted > blocked/restricted > admins-only), so the reason
 * shown client-side always matches what the backend would actually reject
 * the send for. Used both to gate the current chat's Composer and to filter
 * forwarding destinations, so the two stay consistent.
 */
export function getSendBlockedReason(chat: Chat, userId?: string): SendBlockedReason {
  if (isChatEnded(chat)) return 'ended';
  if (chat.type === 'direct') {
    return chat.blockedState && chat.blockedState !== 'none' ? 'blocked' : null;
  }
  if (chat.type === 'group') {
    if (isRestrictedMember(chat, userId)) return 'restricted';
    if (chat.sendMode === 'admins_only' && !isGroupAdmin(chat, userId)) return 'admins_only';
  }
  return null;
}

export function canSendToChat(chat: Chat, userId?: string): boolean {
  return getSendBlockedReason(chat, userId) === null;
}
