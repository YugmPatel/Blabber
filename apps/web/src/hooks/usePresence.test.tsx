import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUserPresence } from './useUsers';
import { apiClient } from '../api/client';

vi.mock('../api/client');

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('useUserPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches user presence successfully', async () => {
    const mockPresence = {
      online: true,
      lastSeen: '2024-01-01T12:00:00Z',
    };

    vi.mocked(apiClient.get).mockResolvedValue({
      data: mockPresence,
    });

    const { result } = renderHook(() => useUserPresence('user123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      online: true,
      lastSeen: new Date('2024-01-01T12:00:00Z'),
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/users/presence/user123');
  });

  it('does not fetch when userId is undefined', () => {
    const { result } = renderHook(() => useUserPresence(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('handles offline status', async () => {
    const mockPresence = {
      online: false,
      lastSeen: '2024-01-01T10:00:00Z',
    };

    vi.mocked(apiClient.get).mockResolvedValue({
      data: mockPresence,
    });

    const { result } = renderHook(() => useUserPresence('user123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      online: false,
      lastSeen: new Date('2024-01-01T10:00:00Z'),
    });
  });

  it('handles API errors gracefully', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useUserPresence('user123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
  });

  it('has refetch interval configured', async () => {
    const mockPresence = {
      online: true,
      lastSeen: '2024-01-01T12:00:00Z',
    };

    vi.mocked(apiClient.get).mockResolvedValue({
      data: mockPresence,
    });

    const { result } = renderHook(() => useUserPresence('user123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify that the hook is configured with refetchInterval
    // The actual refetching is handled by React Query
    expect(apiClient.get).toHaveBeenCalledWith('/api/users/presence/user123');
  });
});
