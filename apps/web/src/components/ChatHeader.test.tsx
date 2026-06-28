import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import ChatHeader from './ChatHeader';
import type { Chat } from '@repo/types';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn((url: string) => {
      if (url.includes('/calls/active')) {
        return Promise.resolve({ data: { activeCall: null } });
      }
      const userId = url.split('/').pop() || 'user';
      return Promise.resolve({
        data: {
          user: {
            _id: userId,
            username: userId,
            email: `${userId}@example.com`,
            name: userId === 'user2' ? 'Alice' : userId,
          },
        },
      });
    }),
  },
  searchChatMessages: vi.fn(() => Promise.resolve({ results: [] })),
  normalizeMediaUrl: vi.fn((url?: string) => url),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'user1', username: 'testuser', email: 'test@example.com', name: 'Test User' },
    accessToken: 'test-token',
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUser: vi.fn(() => ({ data: undefined })),
  useUserPresence: vi.fn(() => ({ data: undefined })),
  useSearchUsers: vi.fn(() => ({ data: [], isFetching: false })),
}));

vi.mock('@/hooks/useChats', () => ({
  useAddMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateInviteLink: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteGroup: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDemoteMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useInviteLinkSettings: vi.fn(() => ({ data: null, isLoading: false })),
  useLeaveGroup: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePromoteMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRegenerateInviteLink: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRevokeInviteLink: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useTransferOwnership: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateChat: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const mockDirectChat: Chat = {
  _id: 'chat1',
  type: 'direct',
  participants: ['user1', 'user2'],
  admins: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockGroupChat: Chat = {
  _id: 'chat2',
  type: 'group',
  participants: ['user1', 'user2', 'user3'],
  admins: ['user1'],
  title: 'Team Chat',
  avatarUrl: 'https://example.com/group.jpg',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockGetChatTitle = (chat: Chat) => {
  return chat.type === 'group' ? chat.title || 'Group' : 'Alice';
};

const mockGetChatAvatar = (chat: Chat) => {
  return chat.avatarUrl;
};

const renderHeader = (ui: ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('ChatHeader', () => {
  it('renders chat title', () => {
    renderHeader(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={false}
      />
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows online status for direct chats', () => {
    renderHeader(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        onlineStatus={{ online: true, lastSeen: new Date() }}
        isGroupChat={false}
      />
    );
    expect(screen.getByText('online')).toBeInTheDocument();
  });

  it('shows last seen for offline users', () => {
    const lastSeen = new Date();
    lastSeen.setMinutes(lastSeen.getMinutes() - 30);

    renderHeader(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        onlineStatus={{ online: false, lastSeen }}
        isGroupChat={false}
      />
    );
    expect(screen.getByText(/last seen/)).toBeInTheDocument();
  });

  it('shows participant count for group chats', () => {
    renderHeader(
      <ChatHeader
        chat={mockGroupChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={true}
      />
    );
    expect(screen.getByText('3 members')).toBeInTheDocument();
  });

  it('opens menu when clicking options button', () => {
    renderHeader(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={false}
      />
    );

    const optionsButton = screen.getByLabelText('More options');
    fireEvent.click(optionsButton);

    expect(screen.getByText('View profile')).toBeInTheDocument();
    expect(screen.getByText('Search in chat')).toBeInTheDocument();
    expect(screen.getByText('Mute notifications')).toBeInTheDocument();
  });

  it('shows group-specific options for group chats', () => {
    renderHeader(
      <ChatHeader
        chat={mockGroupChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={true}
      />
    );

    const optionsButton = screen.getByLabelText('More options');
    fireEvent.click(optionsButton);

    expect(screen.getByText('View profile')).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('closes menu when clicking outside', async () => {
    renderHeader(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={false}
      />
    );

    const optionsButton = screen.getByLabelText('More options');
    fireEvent.click(optionsButton);

    expect(screen.getByText('View profile')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText('View profile')).not.toBeInTheDocument();
    });
  });

  it('renders avatar with online indicator', () => {
    const { container } = renderHeader(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        onlineStatus={{ online: true, lastSeen: new Date() }}
        isGroupChat={false}
      />
    );

    // Avatar should be rendered
    const avatar = container.querySelector('.relative.inline-flex');
    expect(avatar).toBeInTheDocument();
  });
});
