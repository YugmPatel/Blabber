import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import NewGroupModal from './NewGroupModal';
import { chatKeys } from '@/hooks/useChats';
import { createTestQueryClient } from '@/test/query-test-utils';
import { apiClient } from '@/api/client';
import { searchUsers } from '@/api/client';
import type { Chat } from '@repo/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'me', username: 'me', email: 'me@example.com', name: 'Me' },
    accessToken: 'token',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadMedia: vi.fn() }),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
  searchUsers: vi.fn(),
  // Avatar (rendered for every user row) calls this to resolve src URLs —
  // a passthrough keeps the mock module usable without pulling in the real
  // API-origin-resolution logic.
  normalizeMediaUrl: (url?: string | null) => url ?? undefined,
}));

const existingChat: Chat = {
  _id: 'chat-existing',
  type: 'direct',
  participants: ['me', 'friend-1'],
  participantProfiles: [
    { _id: 'me', name: 'Me', username: 'me', email: 'me@example.com' },
    { _id: 'friend-1', name: 'Friend One', username: 'friend', email: 'friend@example.com' },
  ],
  admins: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const newGroupChat: Chat = {
  _id: 'group-new',
  type: 'group',
  participants: ['me', 'friend-1'],
  admins: ['me'],
  title: 'Weekend Trip',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('NewGroupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mirrors real server behavior: once the group is created, a follow-up
    // GET /api/chats (triggered by this fix's invalidateQueries call) would
    // legitimately include it too — this only tests that the group appears
    // *before* that refetch has to happen, not that the refetch never runs.
    let groupCreated = false;
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/chats') {
        return Promise.resolve({ data: { chats: groupCreated ? [existingChat, newGroupChat] : [existingChat] } });
      }
      return Promise.resolve({ data: {} });
    });
    vi.mocked(searchUsers).mockResolvedValue({ users: [], nextCursor: null });
    vi.mocked(apiClient.post).mockImplementation(async () => {
      groupCreated = true;
      return { data: { chat: newGroupChat } };
    });
  });

  it('inserts the newly created group into the chat list cache and navigates to it, without waiting on a refetch', async () => {
    const queryClient = createTestQueryClient();
    // Pre-warm the chat list cache the way the sidebar's useChats() would
    // have it, so we can observe the group being prepended synchronously.
    queryClient.setQueryData(chatKeys.list(undefined), [existingChat]);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Display name takes priority over the raw username/email (see
    // chat-permissions/member-display fix) — "Friend One" is the primary
    // label, with "@friend" as secondary metadata underneath it.
    const friendButton = await screen.findByText('Friend One');
    fireEvent.click(friendButton);

    fireEvent.click(screen.getByText(/Next \(1 selected\)/));

    const nameInput = await screen.findByPlaceholderText('Enter group name...');
    fireEvent.change(nameInput, { target: { value: 'Weekend Trip' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/chats/group-new');
    });

    const cachedList = queryClient.getQueryData<Chat[]>(chatKeys.list(undefined));
    expect(cachedList?.some((chat) => chat._id === 'group-new')).toBe(true);
  });

  it('sends the selected temporary group completion behavior when creating a group', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(chatKeys.list(undefined), [existingChat]);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByText('Friend One'));
    fireEvent.click(screen.getByText(/Next \(1 selected\)/));

    fireEvent.change(await screen.findByPlaceholderText('Enter group name...'), {
      target: { value: 'Weekend Trip' },
    });
    fireEvent.click(screen.getAllByRole('switch')[0]);
    fireEvent.click(screen.getByRole('button', { name: /End and delete/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/chats',
        expect.objectContaining({
          groupKind: 'temporary',
          temporaryCompletionBehavior: 'end_and_delete',
          expiresAt: expect.any(String),
        })
      );
    });
  });

  it('shows display name as the primary label with @username as secondary metadata, never a raw email as primary when a name exists', async () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText('Friend One');
    expect(screen.getByText('@friend')).toBeInTheDocument();
    // The raw email must not appear as the primary label anywhere it's shown.
    expect(screen.queryByText('friend@example.com')).not.toBeInTheDocument();
  });

  it('falls back to username, then email, when a display name is missing', async () => {
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/chats') {
        return Promise.resolve({
          data: {
            chats: [
              {
                _id: 'chat-no-name',
                type: 'direct',
                participants: ['me', 'usernameOnly-1'],
                participantProfiles: [
                  { _id: 'me', name: 'Me', username: 'me' },
                  { _id: 'usernameOnly-1', name: '', username: 'nonamehere', email: 'noname@example.com' },
                ],
                admins: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // No name field on this user — username becomes the primary label.
    await screen.findByText('nonamehere');
  });

  it('searches the same user discovery source by display name and excludes self', async () => {
    vi.mocked(searchUsers).mockResolvedValue({
      users: [
        {
          id: 'devanshee-1',
          username: 'devanshee',
          displayName: 'Devanshee Shah',
          isVerified: false,
          relationshipStatus: 'accepted',
          canMessage: true,
          requiresMessageRequest: false,
        },
        {
          id: 'me',
          username: 'yugm',
          displayName: 'Yugm Patel',
          isVerified: false,
          relationshipStatus: 'accepted',
          canMessage: true,
          requiresMessageRequest: false,
        },
      ],
      nextCursor: null,
    });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'devanshee' },
    });

    expect(await screen.findByText('Devanshee Shah')).toBeInTheDocument();
    expect(screen.getByText('@devanshee')).toBeInTheDocument();
    expect(screen.queryByText('Yugm Patel')).not.toBeInTheDocument();
    expect(searchUsers).toHaveBeenCalledWith('devanshee');
  });

  it('renders the searched user\'s real profile photo, matching New Convo, instead of a generic initials circle', async () => {
    vi.mocked(searchUsers).mockResolvedValue({
      users: [
        {
          id: 'devanshee-1',
          username: 'devanshee',
          displayName: 'Devanshee Shah',
          avatarUrl: 'https://cdn.example.com/avatars/devanshee.jpg',
          isVerified: false,
          relationshipStatus: 'accepted',
          canMessage: true,
          requiresMessageRequest: false,
        },
      ],
      nextCursor: null,
    });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'devanshee' },
    });

    await screen.findByText('Devanshee Shah');
    const avatarImg = screen.getByRole('img', { name: 'Devanshee Shah' });
    expect(avatarImg).toHaveAttribute('src', 'https://cdn.example.com/avatars/devanshee.jpg');
  });

  it('falls back to an initials avatar (no broken image, no <img>) for a user without a profile photo', async () => {
    vi.mocked(searchUsers).mockResolvedValue({
      users: [
        {
          id: 'no-photo-1',
          username: 'nophotouser',
          displayName: 'No Photo User',
          isVerified: false,
          relationshipStatus: 'accepted',
          canMessage: true,
          requiresMessageRequest: false,
        },
      ],
      nextCursor: null,
    });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'nophotouser' },
    });

    await screen.findByText('No Photo User');
    expect(screen.queryByRole('img', { name: 'No Photo User' })).not.toBeInTheDocument();
    // Avatar falls back to initials derived from the display name.
    expect(screen.getByText('NU')).toBeInTheDocument();
  });

  it('shows profile photos for blank-state recent candidates when available, same as search results', async () => {
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/chats') {
        return Promise.resolve({
          data: {
            chats: [
              {
                _id: 'chat-with-photo',
                type: 'direct',
                participants: ['me', 'friend-photo'],
                participantProfiles: [
                  { _id: 'me', name: 'Me', username: 'me', email: 'me@example.com' },
                  {
                    _id: 'friend-photo',
                    name: 'Friend Photo',
                    username: 'friendphoto',
                    email: 'friend@example.com',
                    avatarUrl: 'https://cdn.example.com/avatars/friend.jpg',
                  },
                ],
                admins: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText('Friend Photo');
    const avatarImg = screen.getByRole('img', { name: 'Friend Photo' });
    expect(avatarImg).toHaveAttribute('src', 'https://cdn.example.com/avatars/friend.jpg');
  });

  it('includes users who require a message request, not only users who can already be messaged directly', async () => {
    // Regression test: group invites are governed by groupInvitePrivacy
    // (defaults to 'everyone' server-side), a separate and more permissive
    // check than messagePrivacy/canMessage. A user search result with
    // canMessage: false must still be selectable for a group — this is
    // exactly the "devanshee shows in New Convo but not Create Group" bug.
    vi.mocked(searchUsers).mockResolvedValue({
      users: [
        {
          id: 'devanshee-1',
          username: 'devanshee',
          displayName: 'Devanshee Shah',
          isVerified: false,
          relationshipStatus: 'none',
          canMessage: false,
          requiresMessageRequest: true,
        },
      ],
      nextCursor: null,
    });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'devanshee' },
    });

    expect(await screen.findByText('Devanshee Shah')).toBeInTheDocument();
    expect(screen.queryByText('No people found')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Devanshee Shah'));
    expect(screen.getByText('Next (1 selected)')).toBeInTheDocument();
  });

  it('prefers profileHandle/displayHandle over the raw username when the backend provides one', async () => {
    vi.mocked(searchUsers).mockResolvedValue({
      users: [
        {
          id: 'handle-user',
          username: 'devanshee123',
          displayName: 'Devanshee Shah',
          isVerified: false,
          relationshipStatus: 'accepted',
          canMessage: true,
          requiresMessageRequest: false,
          profileHandle: 'devanshee',
          displayHandle: '@devanshee',
        },
      ],
      nextCursor: null,
    });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'devanshee' },
    });

    await screen.findByText('Devanshee Shah');
    expect(screen.getByText('@devanshee')).toBeInTheDocument();
    expect(screen.queryByText('@devanshee123')).not.toBeInTheDocument();
  });

  it('does not show "No people found" while a search is still loading', async () => {
    let resolveSearch: (value: { users: never[]; nextCursor: null }) => void = () => {};
    vi.mocked(searchUsers).mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      })
    );
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'devanshee' },
    });

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });
    expect(screen.queryByText('No people found')).not.toBeInTheDocument();

    resolveSearch({ users: [], nextCursor: null });
    expect(await screen.findByText('No people found')).toBeInTheDocument();
  });

  it('searches by username/handle and removes selected users from candidate rows', async () => {
    vi.mocked(searchUsers).mockResolvedValue({
      users: [
        {
          id: 'handle-1',
          username: 'handlematch',
          displayName: 'Handle Match',
          isVerified: false,
          relationshipStatus: 'accepted',
          canMessage: true,
          requiresMessageRequest: false,
        },
      ],
      nextCursor: null,
    });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NewGroupModal isOpen onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Search people you can message...'), {
      target: { value: 'handlematch' },
    });

    const row = await screen.findByText('Handle Match');
    fireEvent.click(row);

    expect(screen.getByText('Next (1 selected)')).toBeInTheDocument();
    expect(screen.getAllByText('Handle Match')).toHaveLength(1);
  });
});
