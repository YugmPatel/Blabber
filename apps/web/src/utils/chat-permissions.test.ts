import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@repo/types';
import { canSendToChat, getSendBlockedReason, isChatEnded, isGroupAdmin } from './chat-permissions';

const NOW = Date.parse('2026-07-14T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function groupChat(overrides: Partial<Chat> = {}): Chat {
  return {
    _id: 'chat-1',
    type: 'group',
    participants: ['user-1', 'user-2'],
    admins: ['user-1'],
    ownerId: 'user-1',
    sendMode: 'everyone',
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

function directChat(overrides: Partial<Chat> = {}): Chat {
  return {
    _id: 'chat-2',
    type: 'direct',
    participants: ['user-1', 'user-2'],
    admins: [],
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

describe('isChatEnded', () => {
  it('is false for a standard group with no endedAt', () => {
    expect(isChatEnded(groupChat())).toBe(false);
  });

  it('is true once endedAt is set', () => {
    expect(isChatEnded(groupChat({ endedAt: new Date(NOW) }))).toBe(true);
  });

  it('is true for a temporary group whose expiresAt has passed, even without endedAt yet', () => {
    expect(
      isChatEnded(
        groupChat({ groupKind: 'temporary', expiresAt: new Date(NOW - 1000) })
      )
    ).toBe(true);
  });

  it('is false for a temporary group whose expiresAt is in the future', () => {
    expect(
      isChatEnded(
        groupChat({ groupKind: 'temporary', expiresAt: new Date(NOW + 1000) })
      )
    ).toBe(false);
  });

  it('is always false for direct chats', () => {
    expect(isChatEnded(directChat({ endedAt: new Date(NOW) } as Partial<Chat>))).toBe(false);
  });
});

describe('isGroupAdmin', () => {
  it('is true for a user in the admins array', () => {
    expect(isGroupAdmin(groupChat(), 'user-1')).toBe(true);
  });

  it('is true for the owner even if not separately listed in admins', () => {
    expect(isGroupAdmin(groupChat({ admins: [], ownerId: 'user-9' }), 'user-9')).toBe(true);
  });

  it('is false for a non-admin member', () => {
    expect(isGroupAdmin(groupChat(), 'user-2')).toBe(false);
  });

  it('is false when no userId is given', () => {
    expect(isGroupAdmin(groupChat(), undefined)).toBe(false);
  });
});

describe('getSendBlockedReason / canSendToChat', () => {
  it('returns null (can send) for a normal group and admin', () => {
    expect(getSendBlockedReason(groupChat(), 'user-1')).toBeNull();
    expect(canSendToChat(groupChat(), 'user-1')).toBe(true);
  });

  it('returns "ended" for an ended temporary group, taking priority over everything else', () => {
    const chat = groupChat({
      groupKind: 'temporary',
      endedAt: new Date(NOW),
      sendMode: 'admins_only',
    });
    expect(getSendBlockedReason(chat, 'user-2')).toBe('ended');
    expect(canSendToChat(chat, 'user-2')).toBe(false);
  });

  it('returns "admins_only" for a non-admin in an admins-only group', () => {
    const chat = groupChat({ sendMode: 'admins_only' });
    expect(getSendBlockedReason(chat, 'user-2')).toBe('admins_only');
    expect(canSendToChat(chat, 'user-2')).toBe(false);
  });

  it('returns null for an admin in an admins-only group', () => {
    const chat = groupChat({ sendMode: 'admins_only' });
    expect(getSendBlockedReason(chat, 'user-1')).toBeNull();
    expect(canSendToChat(chat, 'user-1')).toBe(true);
  });

  it('returns "restricted" for an individually-muted member, even when sendMode is "everyone"', () => {
    const chat = groupChat({
      memberRestrictions: [{ userId: 'user-2', restrictedBy: 'user-1', restrictedAt: new Date(NOW) }],
    });
    expect(getSendBlockedReason(chat, 'user-2')).toBe('restricted');
  });

  it('returns "blocked" for a direct chat with an active block', () => {
    const chat = directChat({ blockedState: 'blocked_by_me' });
    expect(getSendBlockedReason(chat, 'user-1')).toBe('blocked');
    expect(canSendToChat(chat, 'user-1')).toBe(false);
  });

  it('returns null for a direct chat with no block', () => {
    const chat = directChat({ blockedState: 'none' });
    expect(getSendBlockedReason(chat, 'user-1')).toBeNull();
  });
});
