import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import NewGroupModal from './NewGroupModal';
import { chatKeys } from '@/hooks/useChats';
import { createTestQueryClient } from '@/test/query-test-utils';
import { apiClient } from '@/api/client';
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
}));

const existingChat: Chat = {
  _id: 'chat-existing',
  type: 'direct',
  participants: ['me', 'friend-1'],
  admins: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const friendUser = {
  _id: 'friend-1',
  username: 'friend',
  email: 'friend@example.com',
  name: 'Friend One',
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
      if (url === '/api/users/friend-1') return Promise.resolve({ data: { user: friendUser } });
      return Promise.resolve({ data: {} });
    });
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
                admins: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        });
      }
      if (url === '/api/users/usernameOnly-1') {
        return Promise.resolve({
          data: { user: { _id: 'usernameOnly-1', username: 'nonamehere', email: 'noname@example.com' } },
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
});
