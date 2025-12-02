import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store';
import type { Message } from '@repo/types';

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      accessToken: null,
      socket: null,
      isConnected: false,
      activeChat: null,
      pendingMessages: new Map(),
      typingUsers: new Map(),
    });
  });

  describe('Auth state', () => {
    it('should set access token', () => {
      const { setAccessToken, accessToken: initialToken } = useAppStore.getState();
      expect(initialToken).toBeNull();

      setAccessToken('test-token-123');

      const { accessToken } = useAppStore.getState();
      expect(accessToken).toBe('test-token-123');
    });

    it('should clear access token', () => {
      const { setAccessToken } = useAppStore.getState();
      setAccessToken('test-token-123');

      setAccessToken(null);

      const { accessToken } = useAppStore.getState();
      expect(accessToken).toBeNull();
    });
  });

  describe('Socket state', () => {
    it('should set socket instance', () => {
      const mockSocket = { id: 'socket-123' } as any;
      const { setSocket } = useAppStore.getState();

      setSocket(mockSocket);

      const { socket } = useAppStore.getState();
      expect(socket).toBe(mockSocket);
    });

    it('should set connection status', () => {
      const { setIsConnected, isConnected: initialStatus } = useAppStore.getState();
      expect(initialStatus).toBe(false);

      setIsConnected(true);

      const { isConnected } = useAppStore.getState();
      expect(isConnected).toBe(true);
    });

    it('should clear socket instance', () => {
      const mockSocket = { id: 'socket-123' } as any;
      const { setSocket } = useAppStore.getState();
      setSocket(mockSocket);

      setSocket(null);

      const { socket } = useAppStore.getState();
      expect(socket).toBeNull();
    });
  });

  describe('UI state', () => {
    it('should set active chat', () => {
      const { setActiveChat, activeChat: initialChat } = useAppStore.getState();
      expect(initialChat).toBeNull();

      setActiveChat('chat-123');

      const { activeChat } = useAppStore.getState();
      expect(activeChat).toBe('chat-123');
    });

    it('should clear active chat', () => {
      const { setActiveChat } = useAppStore.getState();
      setActiveChat('chat-123');

      setActiveChat(null);

      const { activeChat } = useAppStore.getState();
      expect(activeChat).toBeNull();
    });

    it('should switch between chats', () => {
      const { setActiveChat } = useAppStore.getState();

      setActiveChat('chat-123');
      expect(useAppStore.getState().activeChat).toBe('chat-123');

      setActiveChat('chat-456');
      expect(useAppStore.getState().activeChat).toBe('chat-456');
    });
  });

  describe('Optimistic messages', () => {
    const createMockMessage = (tempId: string): Message => ({
      _id: tempId,
      chatId: 'chat-123',
      senderId: 'user-123',
      body: 'Test message',
      reactions: [],
      status: 'sent',
      deletedFor: [],
      createdAt: new Date(),
    });

    it('should add pending message', () => {
      const { addPendingMessage, pendingMessages: initialMessages } = useAppStore.getState();
      expect(initialMessages.size).toBe(0);

      const tempId = 'temp-123';
      const message = createMockMessage(tempId);
      addPendingMessage(tempId, message);

      const { pendingMessages } = useAppStore.getState();
      expect(pendingMessages.size).toBe(1);
      expect(pendingMessages.get(tempId)).toEqual(message);
    });

    it('should add multiple pending messages', () => {
      const { addPendingMessage } = useAppStore.getState();

      const tempId1 = 'temp-123';
      const tempId2 = 'temp-456';
      const message1 = createMockMessage(tempId1);
      const message2 = createMockMessage(tempId2);

      addPendingMessage(tempId1, message1);
      addPendingMessage(tempId2, message2);

      const { pendingMessages } = useAppStore.getState();
      expect(pendingMessages.size).toBe(2);
      expect(pendingMessages.get(tempId1)).toEqual(message1);
      expect(pendingMessages.get(tempId2)).toEqual(message2);
    });

    it('should resolve pending message with real ID', () => {
      const { addPendingMessage, resolvePendingMessage } = useAppStore.getState();

      const tempId = 'temp-123';
      const realId = 'msg-real-123';
      const message = createMockMessage(tempId);

      addPendingMessage(tempId, message);
      resolvePendingMessage(tempId, realId);

      const { pendingMessages } = useAppStore.getState();
      expect(pendingMessages.size).toBe(0);
      expect(pendingMessages.get(tempId)).toBeUndefined();
    });

    it('should update message ID when resolving', () => {
      const { addPendingMessage, resolvePendingMessage } = useAppStore.getState();

      const tempId = 'temp-123';
      const realId = 'msg-real-123';
      const message = createMockMessage(tempId);

      addPendingMessage(tempId, message);

      // Get reference to the message before resolving
      const pendingMessage = useAppStore.getState().pendingMessages.get(tempId);
      expect(pendingMessage?._id).toBe(tempId);

      resolvePendingMessage(tempId, realId);

      // Message should be removed from pending
      const { pendingMessages } = useAppStore.getState();
      expect(pendingMessages.get(tempId)).toBeUndefined();
    });

    it('should remove pending message', () => {
      const { addPendingMessage, removePendingMessage } = useAppStore.getState();

      const tempId = 'temp-123';
      const message = createMockMessage(tempId);

      addPendingMessage(tempId, message);
      expect(useAppStore.getState().pendingMessages.size).toBe(1);

      removePendingMessage(tempId);

      const { pendingMessages } = useAppStore.getState();
      expect(pendingMessages.size).toBe(0);
    });

    it('should handle resolving non-existent pending message', () => {
      const { resolvePendingMessage } = useAppStore.getState();

      // Should not throw error
      expect(() => {
        resolvePendingMessage('non-existent', 'real-id');
      }).not.toThrow();

      const { pendingMessages } = useAppStore.getState();
      expect(pendingMessages.size).toBe(0);
    });
  });

  describe('Typing indicators', () => {
    it('should set user as typing', () => {
      const { setTyping, typingUsers: initialTyping } = useAppStore.getState();
      expect(initialTyping.size).toBe(0);

      setTyping('chat-123', 'user-456', true);

      const { typingUsers } = useAppStore.getState();
      expect(typingUsers.size).toBe(1);
      expect(typingUsers.get('chat-123')?.has('user-456')).toBe(true);
    });

    it('should set user as not typing', () => {
      const { setTyping } = useAppStore.getState();

      setTyping('chat-123', 'user-456', true);
      expect(useAppStore.getState().typingUsers.get('chat-123')?.has('user-456')).toBe(true);

      setTyping('chat-123', 'user-456', false);

      const { typingUsers } = useAppStore.getState();
      expect(typingUsers.get('chat-123')).toBeUndefined();
    });

    it('should handle multiple users typing in same chat', () => {
      const { setTyping } = useAppStore.getState();

      setTyping('chat-123', 'user-1', true);
      setTyping('chat-123', 'user-2', true);
      setTyping('chat-123', 'user-3', true);

      const { typingUsers } = useAppStore.getState();
      const chatTyping = typingUsers.get('chat-123');
      expect(chatTyping?.size).toBe(3);
      expect(chatTyping?.has('user-1')).toBe(true);
      expect(chatTyping?.has('user-2')).toBe(true);
      expect(chatTyping?.has('user-3')).toBe(true);
    });

    it('should handle typing in multiple chats', () => {
      const { setTyping } = useAppStore.getState();

      setTyping('chat-1', 'user-1', true);
      setTyping('chat-2', 'user-2', true);
      setTyping('chat-3', 'user-3', true);

      const { typingUsers } = useAppStore.getState();
      expect(typingUsers.size).toBe(3);
      expect(typingUsers.get('chat-1')?.has('user-1')).toBe(true);
      expect(typingUsers.get('chat-2')?.has('user-2')).toBe(true);
      expect(typingUsers.get('chat-3')?.has('user-3')).toBe(true);
    });

    it('should remove chat from typing map when last user stops typing', () => {
      const { setTyping } = useAppStore.getState();

      setTyping('chat-123', 'user-1', true);
      setTyping('chat-123', 'user-2', true);

      expect(useAppStore.getState().typingUsers.get('chat-123')?.size).toBe(2);

      setTyping('chat-123', 'user-1', false);
      expect(useAppStore.getState().typingUsers.get('chat-123')?.size).toBe(1);

      setTyping('chat-123', 'user-2', false);
      expect(useAppStore.getState().typingUsers.get('chat-123')).toBeUndefined();
    });

    it('should get typing users for a chat', () => {
      const { setTyping, getTypingUsers } = useAppStore.getState();

      setTyping('chat-123', 'user-1', true);
      setTyping('chat-123', 'user-2', true);

      const typingUsers = getTypingUsers('chat-123');
      expect(typingUsers).toHaveLength(2);
      expect(typingUsers).toContain('user-1');
      expect(typingUsers).toContain('user-2');
    });

    it('should return empty array for chat with no typing users', () => {
      const { getTypingUsers } = useAppStore.getState();

      const typingUsers = getTypingUsers('chat-123');
      expect(typingUsers).toEqual([]);
    });

    it('should clear all typing users for a chat', () => {
      const { setTyping, clearTypingForChat } = useAppStore.getState();

      setTyping('chat-123', 'user-1', true);
      setTyping('chat-123', 'user-2', true);
      setTyping('chat-123', 'user-3', true);

      expect(useAppStore.getState().typingUsers.get('chat-123')?.size).toBe(3);

      clearTypingForChat('chat-123');

      const { typingUsers } = useAppStore.getState();
      expect(typingUsers.get('chat-123')).toBeUndefined();
    });

    it('should not affect other chats when clearing typing', () => {
      const { setTyping, clearTypingForChat } = useAppStore.getState();

      setTyping('chat-1', 'user-1', true);
      setTyping('chat-2', 'user-2', true);

      clearTypingForChat('chat-1');

      const { typingUsers } = useAppStore.getState();
      expect(typingUsers.get('chat-1')).toBeUndefined();
      expect(typingUsers.get('chat-2')?.has('user-2')).toBe(true);
    });
  });

  describe('Store integration', () => {
    it('should handle multiple state updates independently', () => {
      const { setAccessToken, setActiveChat, setIsConnected } = useAppStore.getState();

      setAccessToken('token-123');
      setActiveChat('chat-456');
      setIsConnected(true);

      const state = useAppStore.getState();
      expect(state.accessToken).toBe('token-123');
      expect(state.activeChat).toBe('chat-456');
      expect(state.isConnected).toBe(true);
    });

    it('should maintain state consistency across updates', () => {
      const { setAccessToken, addPendingMessage, setTyping } = useAppStore.getState();

      setAccessToken('token-123');

      const message: Message = {
        _id: 'temp-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        body: 'Test',
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(),
      };

      addPendingMessage('temp-1', message);
      setTyping('chat-1', 'user-2', true);

      const state = useAppStore.getState();
      expect(state.accessToken).toBe('token-123');
      expect(state.pendingMessages.size).toBe(1);
      expect(state.typingUsers.size).toBe(1);
    });
  });
});
