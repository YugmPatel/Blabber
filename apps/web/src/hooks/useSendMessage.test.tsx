import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSendMessage } from './useSendMessage';
import { useAppStore } from '@/store/app-store';
import { useAuth } from '@/contexts/AuthContext';
import type { ReactNode } from 'react';

// Mock dependencies
vi.mock('@/store/app-store');
vi.mock('@/contexts/AuthContext');

describe('useSendMessage', () => {
  const mockSocketEmit = vi.fn();
  const mockAddPendingMessage = vi.fn();
  const mockSocket = { emit: mockSocketEmit };
  const mockUser = {
    _id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
  };

  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Mock useAppStore
    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = {
        socket: mockSocket,
        addPendingMessage: mockAddPendingMessage,
      };
      return selector ? selector(state) : state;
    });

    // Mock useAuth
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      accessToken: 'token-123',
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
    });
  });

  it('sends message via socket with tempId', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Hello world',
    });

    expect(mockSocketEmit).toHaveBeenCalledWith(
      'message:send',
      expect.objectContaining({
        chatId: 'chat-1',
        body: 'Hello world',
        tempId: expect.stringMatching(/^temp-/),
      })
    );
  });

  it('includes mediaId when provided', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Check this out',
      mediaId: 'media-123',
    });

    expect(mockSocketEmit).toHaveBeenCalledWith(
      'message:send',
      expect.objectContaining({
        chatId: 'chat-1',
        body: 'Check this out',
        mediaId: 'media-123',
        tempId: expect.stringMatching(/^temp-/),
      })
    );
  });

  it('includes replyToId when provided', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Reply message',
      replyToId: 'msg-456',
    });

    expect(mockSocketEmit).toHaveBeenCalledWith(
      'message:send',
      expect.objectContaining({
        chatId: 'chat-1',
        body: 'Reply message',
        replyToId: 'msg-456',
        tempId: expect.stringMatching(/^temp-/),
      })
    );
  });

  it('adds optimistic message to pending messages', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Hello world',
    });

    expect(mockAddPendingMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^temp-/),
      expect.objectContaining({
        _id: expect.stringMatching(/^temp-/),
        chatId: 'chat-1',
        senderId: 'user-123',
        body: 'Hello world',
        status: 'sent',
        reactions: [],
        deletedFor: [],
      })
    );
  });

  it('creates optimistic message with media placeholder', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Image message',
      mediaId: 'media-123',
    });

    expect(mockAddPendingMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^temp-/),
      expect.objectContaining({
        body: 'Image message',
        media: {
          type: 'image',
          url: '',
        },
      })
    );
  });

  it('creates optimistic message with reply placeholder', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Reply message',
      replyToId: 'msg-456',
    });

    expect(mockAddPendingMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^temp-/),
      expect.objectContaining({
        body: 'Reply message',
        replyTo: {
          messageId: 'msg-456',
          body: '',
          senderId: '',
        },
      })
    );
  });

  it('does not send message if socket is not connected', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = {
        socket: null,
        addPendingMessage: mockAddPendingMessage,
      };
      return selector ? selector(state) : state;
    });

    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Hello world',
    });

    expect(mockSocketEmit).not.toHaveBeenCalled();
    expect(mockAddPendingMessage).not.toHaveBeenCalled();
  });

  it('does not send message if user is not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
    });

    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Hello world',
    });

    expect(mockSocketEmit).not.toHaveBeenCalled();
    expect(mockAddPendingMessage).not.toHaveBeenCalled();
  });

  it('generates unique tempIds for multiple messages', () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Message 1',
    });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'Message 2',
    });

    const calls = mockSocketEmit.mock.calls;
    const tempId1 = calls[0][1].tempId;
    const tempId2 = calls[1][1].tempId;

    expect(tempId1).not.toBe(tempId2);
  });

  it('updates query cache with optimistic message', async () => {
    // Pre-populate cache with existing messages
    queryClient.setQueryData(['messages', 'list', 'chat-1'], {
      pages: [
        {
          messages: [
            {
              _id: 'msg-1',
              chatId: 'chat-1',
              senderId: 'user-456',
              body: 'Existing message',
              reactions: [],
              status: 'sent',
              deletedFor: [],
              createdAt: new Date('2024-01-01'),
            },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });

    const { result } = renderHook(() => useSendMessage(), { wrapper });

    result.current.sendMessage({
      chatId: 'chat-1',
      body: 'New message',
    });

    await waitFor(() => {
      const data = queryClient.getQueryData(['messages', 'list', 'chat-1']) as any;
      expect(data.pages[0].messages).toHaveLength(2);
      expect(data.pages[0].messages[0].body).toBe('New message');
    });
  });
});
