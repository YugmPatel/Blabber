import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageList from './MessageList';
import type { Message } from '@repo/types';

const mockMessages: Message[] = [
  {
    _id: '1',
    chatId: 'chat1',
    senderId: 'user1',
    body: 'Hello',
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: new Date('2024-01-15T10:00:00'),
  },
  {
    _id: '2',
    chatId: 'chat1',
    senderId: 'user2',
    body: 'Hi there',
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: new Date('2024-01-15T10:01:00'),
  },
  {
    _id: '3',
    chatId: 'chat1',
    senderId: 'user1',
    body: 'How are you?',
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: new Date('2024-01-16T09:00:00'),
  },
];

const mockGetUserName = (userId: string) => {
  return userId === 'user1' ? 'Alice' : 'Bob';
};

const mockGetUserAvatar = (userId: string) => {
  return userId === 'user1' ? 'https://example.com/alice.jpg' : undefined;
};

describe('MessageList', () => {
  it('renders empty state when no messages', () => {
    render(
      <MessageList
        messages={[]}
        currentUserId="user1"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        getUserName={mockGetUserName}
        getUserAvatar={mockGetUserAvatar}
        isGroupChat={false}
      />
    );
    expect(screen.getByText('No messages yet. Start the conversation!')).toBeInTheDocument();
  });

  it('renders messages', () => {
    render(
      <MessageList
        messages={mockMessages}
        currentUserId="user1"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        getUserName={mockGetUserName}
        getUserAvatar={mockGetUserAvatar}
        isGroupChat={false}
      />
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('How are you?')).toBeInTheDocument();
  });

  it('groups messages by date', () => {
    render(
      <MessageList
        messages={mockMessages}
        currentUserId="user1"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        getUserName={mockGetUserName}
        getUserAvatar={mockGetUserAvatar}
        isGroupChat={false}
      />
    );
    // Should have date dividers for Jan 15 and Jan 16
    expect(screen.getByText(/Jan 15/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 16/)).toBeInTheDocument();
  });

  it('shows loading indicator when fetching next page', () => {
    const { container } = render(
      <MessageList
        messages={mockMessages}
        currentUserId="user1"
        hasNextPage={true}
        isFetchingNextPage={true}
        fetchNextPage={vi.fn()}
        getUserName={mockGetUserName}
        getUserAvatar={mockGetUserAvatar}
        isGroupChat={false}
      />
    );
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows sender names in group chats', () => {
    render(
      <MessageList
        messages={mockMessages}
        currentUserId="user1"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        getUserName={mockGetUserName}
        getUserAvatar={mockGetUserAvatar}
        isGroupChat={true}
      />
    );
    // Bob's message should show his name
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('does not show sender names in direct chats', () => {
    render(
      <MessageList
        messages={mockMessages}
        currentUserId="user1"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        getUserName={mockGetUserName}
        getUserAvatar={mockGetUserAvatar}
        isGroupChat={false}
      />
    );
    // Bob's name should not appear
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });
});
