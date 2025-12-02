import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type { User, UpdateUserDTO } from '@repo/types';

// Query keys
export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => [...userKeys.all, id] as const,
  search: (query: string) => [...userKeys.all, 'search', query] as const,
  presence: (id: string) => [...userKeys.all, 'presence', id] as const,
};

// Fetch user by ID
export const useUser = (userId: string | undefined) => {
  return useQuery({
    queryKey: userKeys.detail(userId || ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ user: User }>(`/api/users/${userId}`);
      return data.user;
    },
    enabled: !!userId,
  });
};

// Search users
export const useSearchUsers = (query: string) => {
  return useQuery({
    queryKey: userKeys.search(query),
    queryFn: async () => {
      const { data } = await apiClient.get<{ users: User[] }>('/api/users/search', {
        params: { q: query },
      });
      return data.users;
    },
    enabled: query.length >= 2, // Only search if query is at least 2 characters
  });
};

// Get user presence
export const useUserPresence = (userId: string | undefined) => {
  return useQuery({
    queryKey: userKeys.presence(userId || ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ online: boolean; lastSeen: string }>(
        `/api/users/presence/${userId}`
      );
      return {
        online: data.online,
        lastSeen: new Date(data.lastSeen),
      };
    },
    enabled: !!userId,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};

// Update user profile
export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateUserDTO) => {
      const response = await apiClient.patch<{ user: User }>('/api/users/me', data);
      return response.data.user;
    },
    onSuccess: (updatedUser) => {
      // Update the user detail cache
      queryClient.setQueryData(userKeys.detail(updatedUser._id), updatedUser);
      // Invalidate all user queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
};

// Block user
export const useBlockUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.post('/api/users/block', { userId });
    },
    onSuccess: () => {
      // Invalidate user queries
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
};

// Unblock user
export const useUnblockUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.post('/api/users/unblock', { userId });
    },
    onSuccess: () => {
      // Invalidate user queries
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
};
