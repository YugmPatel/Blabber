import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '../api/client';
import { renderQueryHook, waitFor } from '../test/query-test-utils';
import {
  useUser,
  useSearchUsers,
  useUserPresence,
  useUpdateProfile,
  useBlockUser,
  useUnblockUser,
  userKeys,
} from './useUsers';
import type { User } from '@repo/types';

// Mock the API client
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('useUsers hooks', () => {
  const mockUser: User = {
    _id: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    about: 'Test bio',
    contacts: [],
    blocked: [],
    lastSeen: new Date('2024-01-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useUser', () => {
    it('should fetch user by ID', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { user: mockUser },
      });

      const { result } = renderQueryHook(() => useUser('user-1'));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/users/user-1');
      expect(result.current.data).toEqual(mockUser);
    });

    it('should not fetch when userId is undefined', () => {
      const { result } = renderQueryHook(() => useUser(undefined));

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const error = new Error('User not found');
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      const { result } = renderQueryHook(() => useUser('user-1'));

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useSearchUsers', () => {
    it('should search users with query', async () => {
      const mockUsers = [mockUser];
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { users: mockUsers },
      });

      const { result } = renderQueryHook(() => useSearchUsers('test'));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/users/search', {
        params: { q: 'test' },
      });
      expect(result.current.data).toEqual(mockUsers);
    });

    it('should not search when query is too short', () => {
      const { result } = renderQueryHook(() => useSearchUsers('t'));

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useUserPresence', () => {
    it('should fetch user presence', async () => {
      const mockPresence = {
        online: true,
        lastSeen: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: mockPresence,
      });

      const { result } = renderQueryHook(() => useUserPresence('user-1'));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api/users/presence/user-1');
      expect(result.current.data?.online).toBe(true);
      expect(result.current.data?.lastSeen).toBeInstanceOf(Date);
    });

    it('should not fetch when userId is undefined', () => {
      const { result } = renderQueryHook(() => useUserPresence(undefined));

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useUpdateProfile', () => {
    it('should update user profile', async () => {
      const updatedUser = { ...mockUser, name: 'Updated Name' };
      vi.mocked(apiClient.patch).mockResolvedValueOnce({
        data: { user: updatedUser },
      });

      const { result } = renderQueryHook(() => useUpdateProfile());

      result.current.mutate({ name: 'Updated Name' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.patch).toHaveBeenCalledWith('/api/users/me', { name: 'Updated Name' });
      expect(result.current.data).toEqual(updatedUser);
    });

    it('should handle update errors', async () => {
      const error = new Error('Update failed');
      vi.mocked(apiClient.patch).mockRejectedValueOnce(error);

      const { result } = renderQueryHook(() => useUpdateProfile());

      result.current.mutate({ name: 'Updated Name' });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useBlockUser', () => {
    it('should block a user', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });

      const { result } = renderQueryHook(() => useBlockUser());

      result.current.mutate('user-2');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/users/block', { userId: 'user-2' });
    });
  });

  describe('useUnblockUser', () => {
    it('should unblock a user', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });

      const { result } = renderQueryHook(() => useUnblockUser());

      result.current.mutate('user-2');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.post).toHaveBeenCalledWith('/api/users/unblock', { userId: 'user-2' });
    });
  });
});
