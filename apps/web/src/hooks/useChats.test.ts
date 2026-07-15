import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { renderQueryHook, waitFor } from '../test/query-test-utils';
import {
  useChats,
  useChat,
  useCreateChat,
  useUpdateChat,
  useAddMember,
  useRemoveMember,
  useDeleteGroup,
  useEndGroup,
  usePinChat,
  useArchiveChat,
  chatKeys,
} from './useChats';
import type { Chat } from '@repo/types';

// Mock the API client
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('useChats hooks', () => {
  const mockChat: Chat = {
    _id: 'chat-1',
    type: 'direct',
    participants: ['user-1', 'user-2'],
    admins: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockGroupChat: Chat = {
    _id: 'chat-2',
    type: 'group',
    participants: ['user-1', 'user-2', 'user-3'],
    admins: ['user-1'],
    title: 'Test Group',
    avatarUrl: 'https://example.com/group.jpg',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const keepChatListCache = (queryClient: QueryClient) => {
    queryClient.setQueryDefaults(chatKeys.list(undefined), { gcTime: Infinity });
  };

  describe('useChats', () => {
    it('should fetch all chats', async () => {
      const mockChats = [mockChat, mockGroupChat];
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { chats: mockChats },
      });

      const { result } = renderQueryHook(() => useChats());

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/chats', { params: undefined });
      expect(result.current.data).toEqual(mockChats);
    });

    it('should fetch chats with filters', async () => {
      const mockChats = [mockChat];
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { chats: mockChats },
      });

      const { result } = renderQueryHook(() => useChats({ archived: false, limit: 20 }));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/chats', {
        params: { archived: false, limit: 20 },
      });
      expect(result.current.data).toEqual(mockChats);
    });

    it('should handle errors', async () => {
      const error = new Error('Failed to fetch chats');
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      const { result } = renderQueryHook(() => useChats());

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useChat', () => {
    it('should fetch single chat', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { chat: mockChat },
      });

      const { result } = renderQueryHook(() => useChat('chat-1'));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/chats/chat-1');
      expect(result.current.data).toEqual(mockChat);
    });

    it('should not fetch when chatId is undefined', () => {
      const { result } = renderQueryHook(() => useChat(undefined));

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useCreateChat', () => {
    it('should create a direct chat', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { chat: mockChat },
      });

      const { result } = renderQueryHook(() => useCreateChat());

      const createData = {
        type: 'direct' as const,
        participantIds: ['user-1', 'user-2'],
      };

      result.current.mutate(createData);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/chats', createData);
      expect(result.current.data).toEqual(mockChat);
    });

    it('should create a group chat', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { chat: mockGroupChat },
      });

      const { result } = renderQueryHook(() => useCreateChat());

      const createData = {
        type: 'group' as const,
        participantIds: ['user-1', 'user-2', 'user-3'],
        title: 'Test Group',
        avatarUrl: 'https://example.com/group.jpg',
      };

      result.current.mutate(createData);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/chats', createData);
      expect(result.current.data).toEqual(mockGroupChat);
    });
  });

  describe('useUpdateChat', () => {
    it('should update chat', async () => {
      const updatedChat = { ...mockGroupChat, title: 'Updated Group' };
      vi.mocked(apiClient.patch).mockResolvedValueOnce({
        data: { chat: updatedChat },
      });

      const { result } = renderQueryHook(() => useUpdateChat('chat-2'));

      result.current.mutate({ title: 'Updated Group' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.patch).toHaveBeenCalledWith('/api/chats/chat-2', {
        title: 'Updated Group',
      });
      expect(result.current.data).toEqual(updatedChat);
    });
  });

  describe('useAddMember', () => {
    it('should add member to group chat', async () => {
      const updatedChat = {
        ...mockGroupChat,
        participants: [...mockGroupChat.participants, 'user-4'],
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { chat: updatedChat },
      });

      const { result } = renderQueryHook(() => useAddMember('chat-2'));

      result.current.mutate('user-4');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/chats/chat-2/members', {
        userId: 'user-4',
      });
      expect(result.current.data).toEqual(updatedChat);
    });
  });

  describe('useRemoveMember', () => {
    it('should remove member from group chat', async () => {
      const updatedChat = {
        ...mockGroupChat,
        participants: ['user-1', 'user-2'],
      };
      vi.mocked(apiClient.delete).mockResolvedValueOnce({
        data: { chat: updatedChat },
      });

      const { result } = renderQueryHook(() => useRemoveMember('chat-2'));

      result.current.mutate('user-3');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.delete).toHaveBeenCalledWith('/api/chats/chat-2/members/user-3');
      expect(result.current.data).toEqual(updatedChat);
    });
  });

  describe('delete/end group cache updates', () => {
    it('removes a deleted group from cached chat lists immediately', async () => {
      vi.mocked(apiClient.delete).mockResolvedValueOnce({ data: { success: true } });
      const { result, queryClient } = renderQueryHook(() => useDeleteGroup('chat-2'));
      keepChatListCache(queryClient);
      queryClient.setQueryData(chatKeys.list(undefined), [mockChat, mockGroupChat]);

      result.current.mutate('Test Group');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.delete).toHaveBeenCalledWith('/api/chats/chat-2', {
        data: { confirmation: 'Test Group' },
      });
      expect(queryClient.getQueryData<Chat[]>(chatKeys.list(undefined))?.map((chat) => chat._id)).toEqual(['chat-1']);
      expect(queryClient.getQueryData(chatKeys.detail('chat-2'))).toBeUndefined();
    });

    it('removes an end-and-delete temporary group from cached chat lists immediately', async () => {
      const deletedChat = {
        ...mockGroupChat,
        groupKind: 'temporary' as const,
        temporaryCompletionBehavior: 'end_and_delete' as const,
        endedAt: new Date('2024-01-02'),
        deletedAt: new Date('2024-01-02'),
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { chat: deletedChat } });
      const { result, queryClient } = renderQueryHook(() => useEndGroup('chat-2'));
      keepChatListCache(queryClient);
      queryClient.setQueryData(chatKeys.list(undefined), [mockChat, mockGroupChat]);

      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.post).toHaveBeenCalledWith('/api/chats/chat-2/end');
      expect(queryClient.getQueryData<Chat[]>(chatKeys.list(undefined))?.map((chat) => chat._id)).toEqual(['chat-1']);
      expect(queryClient.getQueryData(chatKeys.detail('chat-2'))).toBeUndefined();
    });

    it('keeps an end-only temporary group visible as ended', async () => {
      const endedChat = {
        ...mockGroupChat,
        groupKind: 'temporary' as const,
        temporaryCompletionBehavior: 'end_only' as const,
        endedAt: new Date('2024-01-02'),
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { chat: endedChat } });
      const { result, queryClient } = renderQueryHook(() => useEndGroup('chat-2'));
      keepChatListCache(queryClient);
      queryClient.setQueryData(chatKeys.list(undefined), [mockChat, mockGroupChat]);

      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(queryClient.getQueryData<Chat[]>(chatKeys.list(undefined))?.find((chat) => chat._id === 'chat-2')?.endedAt).toEqual(
        endedChat.endedAt
      );
    });
  });

  describe('usePinChat', () => {
    it('should pin a chat', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });

      const { result } = renderQueryHook(() => usePinChat());

      result.current.mutate('chat-1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/chats/chat-1/pin');
    });
  });

  describe('useArchiveChat', () => {
    it('should archive a chat', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });

      const { result } = renderQueryHook(() => useArchiveChat());

      result.current.mutate('chat-1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/chats/chat-1/archive');
    });
  });
});
