import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  apiClient,
  createInviteLink,
  fetchInviteLinkSettings,
  joinInvite,
  previewInvite,
  regenerateInviteLink,
  revokeInviteLink,
} from '../api/client';
import type { InviteSettingsPayload } from '../api/client';
import type { Chat, CreateChatDTO, UpdateChatDTO } from '@repo/types';

// Query keys
export const chatKeys = {
  all: ['chats'] as const,
  lists: () => [...chatKeys.all, 'list'] as const,
  list: (filters?: { archived?: boolean }) => [...chatKeys.lists(), filters] as const,
  detail: (id: string) => [...chatKeys.all, id] as const,
  invite: (id: string) => [...chatKeys.all, id, 'invite-link'] as const,
  invitePreview: (token: string) => [...chatKeys.all, 'invite-preview', token] as const,
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

export const usePromoteMember = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.post<{ chat: Chat }>(`/api/chats/${chatId}/admins`, {
        userId,
      });
      return response.data.chat;
    },
    onSuccess: (updatedChat) => {
      queryClient.setQueryData(chatKeys.detail(chatId), updatedChat);
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

export const useDemoteMember = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.delete<{ chat: Chat }>(`/api/chats/${chatId}/admins`, {
        data: { userId },
      });
      return response.data.chat;
    },
    onSuccess: (updatedChat) => {
      queryClient.setQueryData(chatKeys.detail(chatId), updatedChat);
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

export const useTransferOwnership = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.patch<{ chat: Chat }>(`/api/chats/${chatId}/owner`, {
        userId,
      });
      return response.data.chat;
    },
    onSuccess: (updatedChat) => {
      queryClient.setQueryData(chatKeys.detail(chatId), updatedChat);
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

export const useLeaveGroup = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.post(`/api/chats/${chatId}/leave`);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: chatKeys.detail(chatId) });
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

export const useDeleteGroup = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (confirmation: string) => {
      await apiClient.delete(`/api/chats/${chatId}`, {
        data: { confirmation },
      });
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: chatKeys.detail(chatId) });
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

export const useUnarchiveChat = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chatId: string) => {
      await apiClient.post(`/api/chats/${chatId}/unarchive`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

export const useInviteLinkSettings = (chatId: string | undefined, enabled = true) => {
  return useQuery({
    queryKey: chatKeys.invite(chatId || ''),
    queryFn: () => fetchInviteLinkSettings(chatId!),
    enabled: Boolean(chatId) && enabled,
  });
};

export const useCreateInviteLink = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InviteSettingsPayload) => createInviteLink(chatId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.invite(chatId) }),
  });
};

export const useRegenerateInviteLink = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InviteSettingsPayload) => regenerateInviteLink(chatId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.invite(chatId) }),
  });
};

export const useRevokeInviteLink = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeInviteLink(chatId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.invite(chatId) }),
  });
};

export const useInvitePreview = (token: string | undefined) => {
  return useQuery({
    queryKey: chatKeys.invitePreview(token || ''),
    queryFn: () => previewInvite(token!),
    enabled: Boolean(token),
    retry: false,
  });
};

export const useJoinInvite = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => joinInvite(token),
    onSuccess: ({ chat }) => {
      queryClient.setQueryData(chatKeys.detail(chat._id), chat);
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};
