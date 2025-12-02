import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSocket } from './useSocket';
import { useSocketContext } from './SocketProvider';

// Mock SocketProvider
vi.mock('./SocketProvider', () => ({
  useSocketContext: vi.fn(),
}));

describe('useSocket', () => {
  it('should return socket context', () => {
    const mockContext = {
      socket: { id: 'test-socket' } as any,
      isConnected: true,
    };

    vi.mocked(useSocketContext).mockReturnValue(mockContext);

    const { result } = renderHook(() => useSocket());

    expect(result.current).toEqual(mockContext);
    expect(result.current.socket?.id).toBe('test-socket');
    expect(result.current.isConnected).toBe(true);
  });

  it('should return null socket when not connected', () => {
    const mockContext = {
      socket: null,
      isConnected: false,
    };

    vi.mocked(useSocketContext).mockReturnValue(mockContext);

    const { result } = renderHook(() => useSocket());

    expect(result.current.socket).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });
});
