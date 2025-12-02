import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ChatView from './ChatView';
import { AuthProvider } from '@/contexts/AuthContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/query-test-utils';
import * as useChatsModule from '@/hooks/useChats';
import * as useMessagesModule from '@/hooks/useMessages';
import * as useUsersModule from '@/hooks/useUsers';
import type { Chat, Message } from '@repo/types';

// Mock the hooks
vi.mock('@/hooks/useChats');
vi.mock('@/hooks/useMessages');
vi.mock('@/hooks/useUsers');

const mockChat: Chat = {
  _id: 'chat1',
  type: 'direct',
  participants: ['user1', 'user2'],
  admins: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMessages: Message[] = [
  {
    _id: 'msg1',
    chatId: 'chat1',
    senderId: 'user2',
    body: 'Hello!',
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: new Date('2024-01-15T10:00:00'),
  },
  {
    _id: 'msg2',
    chatId: 'chat1',
    senderId: 'user1',
    body: 'Hi there!',
    reactions: [],
    status: 'read',
    deletedFor: [],
    createdAt: new Date('2024-01-15T10:01:00'),
  },
];

const mockUser = {
  _id: 'user2',
  username: 'alice',
  email: 'alice@example.com',
  name: 'Alice',
  avatarUrl: 'https://example.com/alice.jpg',
  contacts: [],
  blocked: [],
  lastSeen: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const renderChatView = (chatId: string = 'chat1') => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/chats/${chatId}`]}>
          <Routes>
            <Route path="/chats/:id" element={<ChatView />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

describe('ChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    vi.spyOn(useMessagesModule, 'useMessages').mockReturnValue({
      data: undefined,
      isLoading: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    vi.spyOn(useUsersModule, 'useUser').mockReturnValue({
      data: undefined,
    } as any);

    vi.spyOn(useUsersModule, 'useUserPresence').mockReturnValue({
      data: undefined,
    } as any);

    renderChatView();

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows error state when chat not found', async () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: undefined,
      isLoading: false,
    } as any);

    vi.spyOn(useMessagesModule, 'useMessages').mockReturnValue({
      data: { pages: [] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    vi.spyOn(useUsersModule, 'useUser').mockReturnValue({
      data: undefined,
    } as any);

    vi.spyOn(useUsersModule, 'useUserPresence').mockReturnValue({
      data: undefined,
    } as any);

    renderChatView();

    await waitFor(() => {
      expect(screen.getByText('Chat not found')).toBeInTheDocument();
    });
  });

  it('renders chat header with chat details', async () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: mockChat,
      isLoading: false,
    } as any);

    vi.spyOn(useMessagesModule, 'useMessages').mockReturnValue({
      data: { pages: [{ messages: mockMessages, nextCursor: null }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    vi.spyOn(useUsersModule, 'useUser').mockReturnValue({
      data: mockUser,
    } as any);

    vi.spyOn(useUsersModule, 'useUserPresence').mockReturnValue({
      data: { online: true, lastSeen: new Date() },
    } as any);

    renderChatView();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('online')).toBeInTheDocument();
    });
  });

  it('renders messages', async () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: mockChat,
      isLoading: false,
    } as any);

    vi.spyOn(useMessagesModule, 'useMessages').mockReturnValue({
      data: { pages: [{ messages: mockMessages, nextCursor: null }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    vi.spyOn(useUsersModule, 'useUser').mockReturnValue({
      data: mockUser,
    } as any);

    vi.spyOn(useUsersModule, 'useUserPresence').mockReturnValue({
      data: { online: false, lastSeen: new Date() },
    } as any);

    renderChatView();

    await waitFor(() => {
      expect(screen.getByText('Hello!')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });
  });

  it('renders group chat correctly', async () => {
    const groupChat: Chat = {
      _id: 'chat2',
      type: 'group',
      participants: ['user1', 'user2', 'user3'],
      admins: ['user1'],
      title: 'Team Chat',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: groupChat,
      isLoading: false,
    } as any);

    vi.spyOn(useMessagesModule, 'useMessages').mockReturnValue({
      data: { pages: [{ messages: [], nextCursor: null }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    vi.spyOn(useUsersModule, 'useUser').mockReturnValue({
      data: undefined,
    } as any);

    vi.spyOn(useUsersModule, 'useUserPresence').mockReturnValue({
      data: undefined,
    } as any);

    renderChatView('chat2');

    await waitFor(() => {
      expect(screen.getByText('Team Chat')).toBeInTheDocument();
      expect(screen.getByText('3 participants')).toBeInTheDocument();
    });
  });

  it('renders message composer placeholder', async () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: mockChat,
      isLoading: false,
    } as any);

    vi.spyOn(useMessagesModule, 'useMessages').mockReturnValue({
      data: { pages: [{ messages: [], nextCursor: null }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    vi.spyOn(useUsersModule, 'useUser').mockReturnValue({
      data: mockUser,
    } as any);

    vi.spyOn(useUsersModule, 'useUserPresence').mockReturnValue({
      data: undefined,
    } as any);

    renderChatView();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    });
  });
});
