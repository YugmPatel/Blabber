import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '../api/client';
import { renderQueryHook, waitFor } from '../test/query-test-utils';
import {
  useMessages,
  useSendMessage,
  useEditMessage,
  useDeleteMessage,
  useAddReaction,
  useMarkMessagesRead,
  messageKeys,
} from './useMessages';
import type { Message } from '@repo/types';

// Mock the API client
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('useMessages hooks', () => {
  const mockMessage: Message = {
    _id: 'msg-1',
    chatId: 'chat-1',
    senderId: 'user-1',
    body: 'Hello, world!',
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: new Date('2024-01-01'),
  };

  const mockMessage2: Message = {
    _id: 'msg-2',
    chatId: 'chat-1',
    senderId: 'user-2',
    body: 'Hi there!',
    reactions: [],
    status: 'delivered',
    deletedFor: [],
    createdAt: new Date('2024-01-02'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useMessages', () => {
    it('should fetch messages with pagination', async () => {
      const mockResponse = {
        messages: [mockMessage, mockMessage2],
        nextCursor: 'cursor-1',
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: mockResponse,
      });

      const { result } = renderQueryHook(() => useMessages('chat-1'));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/messages/chat-1', {
        params: { cursor: undefined, limit: 50 },
      });
      expect(result.current.data?.pages[0]).toEqual(mockResponse);
    });

    it('should fetch next page with cursor', async () => {
      const firstPage = {
        messages: [mockMessage],
        nextCursor: 'cursor-1',
      };

      const secondPage = {
        messages: [mockMessage2],
        nextCursor: null,
      };

      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: firstPage })
        .mockResolvedValueOnce({ data: secondPage });

      const { result } = renderQueryHook(() => useMessages('chat-1'));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Fetch next page
      result.current.fetchNextPage();

      await waitFor(() => expect(result.current.data?.pages.length).toBe(2));

      expect(apiClient.get).toHaveBeenCalledTimes(2);
      expect(apiClient.get).toHaveBeenNthCalledWith(2, '/api/messages/chat-1', {
        params: { cursor: 'cursor-1', limit: 50 },
      });
      expect(result.current.data?.pages[1]).toEqual(secondPage);
    });

    it('should not fetch when chatId is undefined', () => {
      const { result } = renderQueryHook(() => useMessages(undefined));

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should use custom limit', async () => {
      const mockResponse = {
        messages: [mockMessage],
        nextCursor: null,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: mockResponse,
      });

      const { result } = renderQueryHook(() => useMessages('chat-1', 20));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/messages/chat-1', {
        params: { cursor: undefined, limit: 20 },
      });
    });
  });

  describe('useSendMessage', () => {
    it('should send a message', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: mockMessage },
      });

      const { result } = renderQueryHook(() => useSendMessage('chat-1'));

      result.current.mutate({ body: 'Hello, world!' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/messages/chat-1', {
        body: 'Hello, world!',
      });
      expect(result.current.data).toEqual(mockMessage);
    });

    it('should handle optimistic updates with tempId', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: mockMessage },
      });

      const { result } = renderQueryHook(() => useSendMessage('chat-1'));

      result.current.mutate({ body: 'Hello, world!', tempId: 'temp-123' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/messages/chat-1', {
        body: 'Hello, world!',
        tempId: 'temp-123',
      });
      expect(result.current.data).toEqual(mockMessage);
    });

    it('should send message with media', async () => {
      const messageWithMedia = {
        ...mockMessage,
        media: {
          type: 'image' as const,
          url: 'https://example.com/image.jpg',
        },
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: messageWithMedia },
      });

      const { result } = renderQueryHook(() => useSendMessage('chat-1'));

      result.current.mutate({ body: 'Check this out!', mediaId: 'media-1' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/messages/chat-1', {
        body: 'Check this out!',
        mediaId: 'media-1',
      });
    });
  });

  describe('useEditMessage', () => {
    it('should edit a message', async () => {
      const editedMessage = {
        ...mockMessage,
        body: 'Edited message',
        editedAt: new Date('2024-01-03'),
      };

      vi.mocked(apiClient.patch).mockResolvedValueOnce({
        data: { message: editedMessage },
      });

      const { result, queryClient } = renderQueryHook(() => useEditMessage('chat-1'));

      // Pre-populate the cache
      queryClient.setQueryData(messageKeys.list('chat-1'), {
        pages: [{ messages: [mockMessage], nextCursor: null }],
        pageParams: [undefined],
      });

      result.current.mutate({ messageId: 'msg-1', data: { body: 'Edited message' } });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.patch).toHaveBeenCalledWith('/api/messages/msg-1', {
        body: 'Edited message',
      });
      expect(result.current.data).toEqual(editedMessage);
    });
  });

  describe('useDeleteMessage', () => {
    it('should delete a message', async () => {
      vi.mocked(apiClient.delete).mockResolvedValueOnce({ data: { success: true } });

      const { result } = renderQueryHook(() => useDeleteMessage('chat-1'));

      result.current.mutate('msg-1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.delete).toHaveBeenCalledWith('/api/messages/msg-1');
      expect(result.current.data).toBe('msg-1');
    });
  });

  describe('useAddReaction', () => {
    it('should add a reaction to a message', async () => {
      const messageWithReaction = {
        ...mockMessage,
        reactions: [{ userId: 'user-2', emoji: '👍', createdAt: new Date() }],
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: messageWithReaction },
      });

      const { result, queryClient } = renderQueryHook(() => useAddReaction('chat-1'));

      // Pre-populate the cache
      queryClient.setQueryData(messageKeys.list('chat-1'), {
        pages: [{ messages: [mockMessage], nextCursor: null }],
        pageParams: [undefined],
      });

      result.current.mutate({ messageId: 'msg-1', data: { emoji: '👍' } });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/messages/msg-1/react', { emoji: '👍' });
      expect(result.current.data).toEqual(messageWithReaction);
    });
  });

  describe('useMarkMessagesRead', () => {
    it('should mark messages as read', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });

      const { result } = renderQueryHook(() => useMarkMessagesRead('chat-1'));

      result.current.mutate(['msg-1', 'msg-2']);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/messages/msg-1/read', {
        messageIds: ['msg-1', 'msg-2'],
      });
    });
  });
});
