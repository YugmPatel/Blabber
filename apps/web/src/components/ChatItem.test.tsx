import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ChatItem from './ChatItem';
import type { Chat } from '@repo/types';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'currentUser', name: 'Current User', email: 'current@example.com' },
  }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUser: vi.fn(() => ({ data: undefined })),
  useUserPresence: vi.fn(() => ({ data: undefined })),
}));

const mockChat: Chat = {
  _id: 'chat1',
  type: 'group',
  participants: ['user1', 'user2'],
  admins: ['user1'],
  title: 'Test Group',
  avatarUrl: 'https://example.com/avatar.jpg',
  lastMessageRef: {
    messageId: 'msg1',
    body: 'Hello world',
    senderId: 'user1',
    createdAt: new Date('2024-01-01T12:00:00Z'),
  },
  createdAt: new Date('2024-01-01T10:00:00Z'),
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

describe('ChatItem', () => {
  it('renders chat item with title and last message', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} />
      </BrowserRouter>
    );

    expect(screen.getByText('Test Group')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('navigates to chat on click', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} />
      </BrowserRouter>
    );

    const chatItem = screen.getByRole('button');
    fireEvent.click(chatItem);

    expect(mockNavigate).toHaveBeenCalledWith('/chats/chat1');
  });

  it('navigates to chat on Enter key', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} />
      </BrowserRouter>
    );

    const chatItem = screen.getByRole('button');
    fireEvent.keyDown(chatItem, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledWith('/chats/chat1');
  });

  it('shows active state when isActive is true', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} isActive={true} />
      </BrowserRouter>
    );

    const chatItem = screen.getByRole('button');
    expect(chatItem).toHaveClass('bg-gray-200');
  });

  it('shows pin icon when isPinned is true', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} isPinned={true} />
      </BrowserRouter>
    );

    const pinIcon = screen.getByRole('button').querySelector('svg');
    expect(pinIcon).toBeInTheDocument();
  });

  it('shows unread badge when unreadCount > 0', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} unreadCount={5} />
      </BrowserRouter>
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows 99+ for unread count over 99', () => {
    render(
      <BrowserRouter>
        <ChatItem chat={mockChat} unreadCount={150} />
      </BrowserRouter>
    );

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows placeholder when no last message', () => {
    const chatWithoutMessage: Chat = {
      ...mockChat,
      lastMessageRef: undefined,
    };

    render(
      <BrowserRouter>
        <ChatItem chat={chatWithoutMessage} />
      </BrowserRouter>
    );

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('renders direct chat with user info', async () => {
    const { useUser, useUserPresence } = await import('@/hooks/useUsers');
    vi.mocked(useUser).mockReturnValue({
      data: { _id: 'user2', name: 'John Doe', avatarUrl: 'https://example.com/john.jpg' },
    } as any);
    vi.mocked(useUserPresence).mockReturnValue({
      data: { online: true, lastSeen: new Date() },
    } as any);

    const directChat: Chat = {
      ...mockChat,
      type: 'direct',
      participants: ['currentUser', 'user2'],
      title: undefined,
    };

    render(
      <BrowserRouter>
        <ChatItem chat={directChat} />
      </BrowserRouter>
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('displays online presence badge for direct chats', async () => {
    const { useUser, useUserPresence } = await import('@/hooks/useUsers');
    vi.mocked(useUser).mockReturnValue({
      data: { _id: 'user2', name: 'John Doe' },
    } as any);
    vi.mocked(useUserPresence).mockReturnValue({
      data: { online: true, lastSeen: new Date() },
    } as any);

    const directChat: Chat = {
      ...mockChat,
      type: 'direct',
      participants: ['currentUser', 'user2'],
      title: undefined,
    };

    const { container } = render(
      <BrowserRouter>
        <ChatItem chat={directChat} />
      </BrowserRouter>
    );

    // Check for presence badge (green dot)
    const presenceBadge = container.querySelector('.bg-green-500');
    expect(presenceBadge).toBeInTheDocument();
  });
});
