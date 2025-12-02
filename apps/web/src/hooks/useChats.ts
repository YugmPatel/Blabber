import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { Chat, CreateChatDTO, UpdateChatDTO } from '@repo/types';

// Query keys
export const chatKeys = {
  all: ['chats'] as const,
  lists: () => [...chatKeys.all, 'list'] as const,
  list: (filters?: { archived?: boolean }) => [...chatKeys.lists(), filters] as const,
  detail: (id: string) => [...chatKeys.all, id] as const,
};

// Fetch all chats
export const useChats = (filters?: { archived?: boolean; limit?: number }) => {
  return useQuery({
    queryKey: chatKeys.list(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<{ chats: Chat[] }>('/api/chats', {
        params: filters,
      });
      return data.chats;
    },
  });
};

// Fetch single chat
export const useChat = (chatId: string | undefined) => {
  return useQuery({
    queryKey: chatKeys.detail(chatId || ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ chat: Chat }>(`/api/chats/${chatId}`);
      return data.chat;
    },
    enabled: !!chatId,
  });
};

// Create chat
export const useCreateChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateChatDTO) => {
      const response = await apiClient.post<{ chat: Chat }>('/api/chats', data);
      return response.data.chat;
    },
    onSuccess: () => {
      // Invalidate chat lists to refetch
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

// Update chat (admin only for groups)
export const useUpdateChat = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateChatDTO) => {
      const response = await apiClient.patch<{ chat: Chat }>(`/api/chats/${chatId}`, data);
      return response.data.chat;
    },
    onSuccess: (updatedChat) => {
      // Update the chat detail cache
      queryClient.setQueryData(chatKeys.detail(chatId), updatedChat);
      // Invalidate chat lists
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

// Add member to group chat
export const useAddMember = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.post<{ chat: Chat }>(`/api/chats/${chatId}/members`, {
        userId,
      });
      return response.data.chat;
    },
    onSuccess: (updatedChat) => {
      // Update the chat detail cache
      queryClient.setQueryData(chatKeys.detail(chatId), updatedChat);
      // Invalidate chat lists
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

// Remove member from group chat
export const useRemoveMember = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.delete<{ chat: Chat }>(
        `/api/chats/${chatId}/members/${userId}`
      );
      return response.data.chat;
    },
    onSuccess: (updatedChat) => {
      // Update the chat detail cache
      queryClient.setQueryData(chatKeys.detail(chatId), updatedChat);
      // Invalidate chat lists
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

// Pin chat
export const usePinChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chatId: string) => {
      await apiClient.post(`/api/chats/${chatId}/pin`);
    },
    onSuccess: () => {
      // Invalidate chat lists to refetch with updated pin status
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

// Archive chat
export const useArchiveChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chatId: string) => {
      await apiClient.post(`/api/chats/${chatId}/archive`);
    },
    onSuccess: () => {
      // Invalidate chat lists to refetch with updated archive status
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};
