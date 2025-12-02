import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, InfiniteData } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import React from 'react';
import { useSocketEvents } from './useSocketEvents';
import { useAppStore } from '@/store/app-store';
import { messageKeys } from './useMessages';
import { chatKeys } from './useChats';
import { userKeys } from './useUsers';
import type { Message, Chat } from '@repo/types';
import type { ServerToClientEvents, ClientToServerEvents } from '@repo/types';

// Mock socket.io-client
vi.mock('socket.io-client');

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('useSocketEvents', () => {
  let queryClient: QueryClient;
  let mockSocket: TypedSocket;
  let eventHandlers: Record<string, Function>;

  beforeEach(() => {
    // Reset Zustand store
    useAppStore.setState({
      pendingMessages: new Map(),
      typingUsers: new Map(),
    });

    // Create a fresh QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Create mock socket with event handler storage
    eventHandlers = {};
    mockSocket = {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      }),
      off: vi.fn((event: string) => {
        delete eventHandlers[event];
      }),
      emit: vi.fn(),
      connected: true,
    } as any;
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('message:new event', () => {
    it('should add new message to React Query cache', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with empty messages
      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [{ messages: [], nextCursor: null }],
        pageParams: [undefined],
      });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate message:new event
      const newMessage: Message = {
        _id: 'msg-1',
        chatId,
        senderId: 'user-1',
        body: 'Hello!',
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(),
      };

      eventHandlers['message:new']({ message: newMessage });

      // Verify message was added to cache
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages).toHaveLength(1);
        expect(data?.pages[0].messages[0]._id).toBe('msg-1');
      });
    });

    it('should resolve optimistic message with tempId', async () => {
      const chatId = 'chat-1';
      const tempId = 'temp-123';

      // Set up initial cache with optimistic message
      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [
          {
            messages: [
              {
                _id: tempId,
                chatId,
                senderId: 'user-1',
                body: 'Hello!',
                reactions: [],
                status: 'sent',
                deletedFor: [],
                createdAt: new Date(),
              },
            ],
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      });

      // Add to pending messages
      const resolvePendingMessage = vi.fn();
      useAppStore.setState({ resolvePendingMessage });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate message:new event with tempId
      const newMessage: Message = {
        _id: 'msg-1',
        chatId,
        senderId: 'user-1',
        body: 'Hello!',
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(),
      };

      eventHandlers['message:new']({ message: newMessage, tempId });

      // Verify resolvePendingMessage was called
      await waitFor(() => {
        expect(resolvePendingMessage).toHaveBeenCalledWith(tempId, 'msg-1');
      });

      // Verify message was updated in cache
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages[0]._id).toBe('msg-1');
      });
    });

    it('should not duplicate messages', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with existing message
      const existingMessage: Message = {
        _id: 'msg-1',
        chatId,
        senderId: 'user-1',
        body: 'Hello!',
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(),
      };

      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [{ messages: [existingMessage], nextCursor: null }],
        pageParams: [undefined],
      });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate message:new event with same message
      eventHandlers['message:new']({ message: existingMessage });

      // Verify message was not duplicated
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages).toHaveLength(1);
      });
    });
  });

  describe('message:edit event', () => {
    it('should update edited message in cache', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with message
      const originalMessage: Message = {
        _id: 'msg-1',
        chatId,
        senderId: 'user-1',
        body: 'Original text',
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(),
      };

      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [{ messages: [originalMessage], nextCursor: null }],
        pageParams: [undefined],
      });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate message:edit event
      const editedMessage: Message = {
        ...originalMessage,
        body: 'Edited text',
        editedAt: new Date(),
      };

      eventHandlers['message:edit']({ message: editedMessage });

      // Verify message was updated
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages[0].body).toBe('Edited text');
        expect(data?.pages[0].messages[0].editedAt).toBeDefined();
      });
    });
  });

  describe('message:delete event', () => {
    it('should remove deleted message from cache', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with messages
      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [
          {
            messages: [
              {
                _id: 'msg-1',
                chatId,
                senderId: 'user-1',
                body: 'Message 1',
                reactions: [],
                status: 'sent',
                deletedFor: [],
                createdAt: new Date(),
              },
              {
                _id: 'msg-2',
                chatId,
                senderId: 'user-1',
                body: 'Message 2',
                reactions: [],
                status: 'sent',
                deletedFor: [],
                createdAt: new Date(),
              },
            ],
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate message:delete event
      eventHandlers['message:delete']({ messageId: 'msg-1', chatId });

      // Verify message was removed
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages).toHaveLength(1);
        expect(data?.pages[0].messages[0]._id).toBe('msg-2');
      });
    });
  });

  describe('receipt:delivered event', () => {
    it('should update message status to delivered', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with sent message
      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [
          {
            messages: [
              {
                _id: 'msg-1',
                chatId,
                senderId: 'user-1',
                body: 'Hello',
                reactions: [],
                status: 'sent',
                deletedFor: [],
                createdAt: new Date(),
              },
            ],
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate receipt:delivered event
      eventHandlers['receipt:delivered']({ messageId: 'msg-1', userId: 'user-2' });

      // Verify status was updated
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages[0].status).toBe('delivered');
      });
    });
  });

  describe('receipt:read event', () => {
    it('should update multiple message statuses to read', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with delivered messages
      queryClient.setQueryData<InfiniteData<any>>(messageKeys.list(chatId), {
        pages: [
          {
            messages: [
              {
                _id: 'msg-1',
                chatId,
                senderId: 'user-1',
                body: 'Message 1',
                reactions: [],
                status: 'delivered',
                deletedFor: [],
                createdAt: new Date(),
              },
              {
                _id: 'msg-2',
                chatId,
                senderId: 'user-1',
                body: 'Message 2',
                reactions: [],
                status: 'delivered',
                deletedFor: [],
                createdAt: new Date(),
              },
            ],
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      });

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate receipt:read event
      eventHandlers['receipt:read']({ messageIds: ['msg-1', 'msg-2'], userId: 'user-2' });

      // Verify statuses were updated
      await waitFor(() => {
        const data = queryClient.getQueryData<InfiniteData<any>>(messageKeys.list(chatId));
        expect(data?.pages[0].messages[0].status).toBe('read');
        expect(data?.pages[0].messages[1].status).toBe('read');
      });
    });
  });

  describe('typing:update event', () => {
    it('should update typing indicators in Zustand store', async () => {
      const chatId = 'chat-1';
      const userId = 'user-2';

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate typing:update event (user starts typing)
      eventHandlers['typing:update']({ chatId, userId, isTyping: true });

      // Verify typing indicator was set
      await waitFor(() => {
        const typingUsers = useAppStore.getState().getTypingUsers(chatId);
        expect(typingUsers).toContain(userId);
      });

      // Simulate typing:update event (user stops typing)
      eventHandlers['typing:update']({ chatId, userId, isTyping: false });

      // Verify typing indicator was removed
      await waitFor(() => {
        const typingUsers = useAppStore.getState().getTypingUsers(chatId);
        expect(typingUsers).not.toContain(userId);
      });
    });
  });

  describe('chat:updated event', () => {
    it('should update chat in cache', async () => {
      const chatId = 'chat-1';

      // Set up initial cache with chat
      const originalChat: Chat = {
        _id: chatId,
        type: 'group',
        participants: ['user-1', 'user-2'],
        admins: ['user-1'],
        title: 'Original Title',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queryClient.setQueryData(chatKeys.detail(chatId), originalChat);

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate chat:updated event
      const updatedChat: Chat = {
        ...originalChat,
        title: 'Updated Title',
        updatedAt: new Date(),
      };

      eventHandlers['chat:updated']({ chat: updatedChat });

      // Verify chat was updated
      await waitFor(() => {
        const data = queryClient.getQueryData<Chat>(chatKeys.detail(chatId));
        expect(data?.title).toBe('Updated Title');
      });
    });
  });

  describe('presence:update event', () => {
    it('should update user presence in cache', async () => {
      const userId = 'user-1';

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate presence:update event
      const lastSeen = new Date();
      eventHandlers['presence:update']({ userId, online: true, lastSeen });

      // Verify presence was updated
      await waitFor(() => {
        const data = queryClient.getQueryData<{ online: boolean; lastSeen: Date }>(
          userKeys.presence(userId)
        );
        expect(data?.online).toBe(true);
        expect(data?.lastSeen).toEqual(lastSeen);
      });
    });
  });

  describe('error event', () => {
    it('should log socket errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Render hook
      renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Simulate error event
      eventHandlers['error']({ message: 'Test error', code: 'TEST_ERROR' });

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalledWith('Socket error:', {
        message: 'Test error',
        code: 'TEST_ERROR',
      });

      consoleSpy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('should remove all event listeners on unmount', () => {
      // Render hook
      const { unmount } = renderHook(() => useSocketEvents(mockSocket), { wrapper });

      // Verify listeners were registered
      expect(mockSocket.on).toHaveBeenCalledTimes(9);

      // Unmount
      unmount();

      // Verify listeners were removed
      expect(mockSocket.off).toHaveBeenCalledTimes(9);
      expect(mockSocket.off).toHaveBeenCalledWith('message:new', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('message:edit', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('message:delete', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('receipt:delivered', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('receipt:read', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('typing:update', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('chat:updated', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('presence:update', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('null socket', () => {
    it('should not register listeners when socket is null', () => {
      // Render hook with null socket
      renderHook(() => useSocketEvents(null), { wrapper });

      // Verify no listeners were registered
      expect(mockSocket.on).not.toHaveBeenCalled();
    });
  });
});
