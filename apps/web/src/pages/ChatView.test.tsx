import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ChatView from './ChatView';
import { AuthProvider } from '@/contexts/AuthContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/query-test-utils';
import * as useChatsModule from '@/hooks/useChats';
import * as useMessagesModule from '@/hooks/useMessages';
import * as useChatSummaryModule from '@/hooks/useChatSummary';
import * as useChatActionsModule from '@/hooks/useChatActions';
import * as useGroupBrainModule from '@/hooks/useGroupBrain';
import * as useUsersModule from '@/hooks/useUsers';
import type { Chat, Message } from '@repo/types';

// Mock the hooks
vi.mock('@/hooks/useChats');
vi.mock('@/hooks/useMessages');
vi.mock('@/hooks/useChatSummary');
vi.mock('@/hooks/useChatActions');
vi.mock('@/hooks/useGroupBrain');
vi.mock('@/hooks/useUsers');
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: { _id: 'user1', username: 'current', email: 'current@example.com', name: 'Current User' },
    accessToken: 'test-token',
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));
vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn((url: string) => {
      if (url.includes('/settings')) {
        return Promise.resolve({ data: { settings: { chatIntelligenceEnabled: true } } });
      }
      if (url.includes('/calls/active')) {
        return Promise.resolve({ data: { activeCall: null } });
      }
      if (url.includes('/api/users/')) {
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
      }
      return Promise.resolve({ data: {} });
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  fetchMessageWindow: vi.fn(),
  normalizeMediaUrl: (url?: string | null) => url ?? null,
  // UserProfileModal (rendered inside ChatHeader) always references this as
  // its queryFn, even when the query is disabled — the mock module needs the
  // export to exist regardless of whether it's ever actually invoked.
  fetchMyProfile: vi.fn().mockResolvedValue({
    name: 'Current User',
    handle: 'current',
    displayHandle: '@current',
    avatarUrl: null,
    relationship: 'self',
  }),
}));

const mockUseChatSummary = () => {
  vi.spyOn(useChatSummaryModule, 'useChatSummary').mockReturnValue({
    summary: null,
    isLoadingSummary: false,
    isFetchingSummary: false,
    summaryError: null,
    generateSummary: vi.fn(),
    isGeneratingSummary: false,
    generateError: null,
  } as any);
};

const mockMutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isLoading: false,
});

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
    mockUseChatSummary();
    vi.spyOn(useChatsModule, 'useChats').mockReturnValue({ data: [], isLoading: false } as any);
    vi.spyOn(useChatsModule, 'useArchiveChat').mockReturnValue(mockMutation() as any);
    vi.spyOn(useChatsModule, 'useUnarchiveChat').mockReturnValue(mockMutation() as any);
    vi.spyOn(useChatsModule, 'useInviteLinkSettings').mockReturnValue({
      data: null,
      isLoading: false,
    } as any);
    vi.spyOn(useChatsModule, 'useRegenerateInviteLink').mockReturnValue(mockMutation() as any);
    vi.spyOn(useChatsModule, 'useRevokeInviteLink').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useDeleteMessage').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useAddReaction').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useVotePoll').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useClosePoll').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useRsvpEvent').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useCancelEvent').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useDownloadEventIcs').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useMarkMessagesRead').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useForwardMessage').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useMessagePins').mockReturnValue({ data: { pins: [] } } as any);
    vi.spyOn(useMessagesModule, 'usePinMessage').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useUnpinMessage').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useSaveMessage').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useUnsaveMessage').mockReturnValue(mockMutation() as any);
    vi.spyOn(useMessagesModule, 'useSharedContent').mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);
    vi.spyOn(useUsersModule, 'useSearchUsers').mockReturnValue({
      data: [],
      isFetching: false,
    } as any);
    vi.spyOn(useChatActionsModule, 'useChatActions').mockReturnValue({
      actions: [],
      isLoadingActions: false,
      createAction: vi.fn(),
      updateAction: vi.fn(),
      deleteAction: vi.fn(),
      isCreatingAction: false,
    } as any);
    vi.spyOn(useGroupBrainModule, 'useGroupBrain').mockReturnValue({
      answers: [],
      isLoadingAnswers: false,
      createAnswer: vi.fn(),
      updateAnswer: vi.fn(),
      deleteAnswer: vi.fn(),
      isCreatingAnswer: false,
    } as any);
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
      expect(screen.getByText('Chat not available')).toBeInTheDocument();
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
      expect(screen.getByText(/members/i)).toBeInTheDocument();
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
      expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
    });
  });

  it('hides the composer and shows a non-scary banner when the current user blocked the other participant', async () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: { ...mockChat, canMessage: false, blockedState: 'blocked_by_me' },
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
      expect(screen.getByText('You blocked this user. Unblock to message again.')).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText(/type a message/i)).not.toBeInTheDocument();
  });

  it('shows the generic blocked copy (not who blocked whom) when the other participant blocked the current user', async () => {
    vi.spyOn(useChatsModule, 'useChat').mockReturnValue({
      data: { ...mockChat, canMessage: false, blockedState: 'blocked' },
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
      expect(screen.getByText("You can't message this user.")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText(/type a message/i)).not.toBeInTheDocument();
  });

  it('renders catch me up action', async () => {
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
      expect(screen.getByRole('button', { name: 'Open Chat Intelligence' })).toBeInTheDocument();
    });
  });
});
