import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import * as apiClient from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(),
}));

describe('AuthContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');
    });

    it('should provide auth context when used within AuthProvider', async () => {
      vi.mocked(apiClient.apiClient.post).mockRejectedValue(new Error('No session'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current).toBeDefined();
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('initialization', () => {
    it('should attempt to refresh token on mount', async () => {
      const mockRefreshResponse = {
        data: { accessToken: 'test-token' },
      };
      const mockUserResponse = {
        data: {
          _id: '1',
          username: 'testuser',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      vi.mocked(apiClient.apiClient.post).mockResolvedValueOnce(mockRefreshResponse);
      vi.mocked(apiClient.apiClient.get).mockResolvedValueOnce(mockUserResponse);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(apiClient.apiClient.post).toHaveBeenCalledWith('/api/auth/refresh');
      expect(apiClient.apiClient.get).toHaveBeenCalledWith('/api/auth/me');
      expect(result.current.user).toEqual(mockUserResponse.data);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('should handle failed initialization gracefully', async () => {
      vi.mocked(apiClient.apiClient.post).mockRejectedValueOnce(new Error('No session'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('login', () => {
    it('should login user and set token', async () => {
      // Mock initial refresh failure
      vi.mocked(apiClient.apiClient.post).mockRejectedValueOnce(new Error('No session'));

      const mockLoginResponse = {
        data: {
          accessToken: 'login-token',
          user: {
            _id: '1',
            username: 'testuser',
            email: 'test@example.com',
            name: 'Test User',
          },
        },
      };

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      vi.mocked(apiClient.apiClient.post).mockResolvedValueOnce(mockLoginResponse);

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(apiClient.apiClient.post).toHaveBeenCalledWith('/api/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
      expect(result.current.user).toEqual(mockLoginResponse.data.user);
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  describe('register', () => {
    it('should register user and set token', async () => {
      // Mock initial refresh failure
      vi.mocked(apiClient.apiClient.post).mockRejectedValueOnce(new Error('No session'));

      const mockRegisterResponse = {
        data: {
          accessToken: 'register-token',
          user: {
            _id: '1',
            username: 'newuser',
            email: 'new@example.com',
            name: 'New User',
          },
        },
      };

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      vi.mocked(apiClient.apiClient.post).mockResolvedValueOnce(mockRegisterResponse);

      await act(async () => {
        await result.current.register('newuser', 'new@example.com', 'password123', 'New User');
      });

      expect(apiClient.apiClient.post).toHaveBeenCalledWith('/api/auth/register', {
        username: 'newuser',
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });
      expect(result.current.user).toEqual(mockRegisterResponse.data.user);
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  describe('logout', () => {
    it('should logout user and clear token', async () => {
      vi.mocked(apiClient.apiClient.post).mockResolvedValue({ data: {} });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(apiClient.apiClient.post).toHaveBeenCalledWith('/api/auth/logout');
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should clear state even if logout request fails', async () => {
      vi.mocked(apiClient.apiClient.post).mockRejectedValueOnce(new Error('No session'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      vi.mocked(apiClient.apiClient.post).mockRejectedValueOnce(new Error('Logout failed'));

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('refreshUser', () => {
    it('should fetch and update current user', async () => {
      vi.mocked(apiClient.apiClient.post).mockRejectedValueOnce(new Error('No session'));

      const mockUserResponse = {
        data: {
          _id: '1',
          username: 'updateduser',
          email: 'updated@example.com',
          name: 'Updated User',
        },
      };

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      vi.mocked(apiClient.apiClient.get).mockResolvedValueOnce(mockUserResponse);

      await act(async () => {
        await result.current.refreshUser();
      });

      expect(apiClient.apiClient.get).toHaveBeenCalledWith('/api/auth/me');
      expect(result.current.user).toEqual(mockUserResponse.data);
    });
  });
});
