import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatHeader from './ChatHeader';
import type { Chat } from '@repo/types';

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

describe('ChatHeader', () => {
  it('renders chat title', () => {
    render(
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
    render(
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

    render(
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
    render(
      <ChatHeader
        chat={mockGroupChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={true}
      />
    );
    expect(screen.getByText('3 participants')).toBeInTheDocument();
  });

  it('opens menu when clicking options button', () => {
    render(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={false}
      />
    );

    const optionsButton = screen.getByLabelText('Chat options');
    fireEvent.click(optionsButton);

    expect(screen.getByText('View Profile')).toBeInTheDocument();
    expect(screen.getByText('Search in Chat')).toBeInTheDocument();
    expect(screen.getByText('Mute Notifications')).toBeInTheDocument();
  });

  it('shows group-specific options for group chats', () => {
    render(
      <ChatHeader
        chat={mockGroupChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={true}
      />
    );

    const optionsButton = screen.getByLabelText('Chat options');
    fireEvent.click(optionsButton);

    expect(screen.getByText('Group Info')).toBeInTheDocument();
    expect(screen.getByText('Leave Group')).toBeInTheDocument();
  });

  it('closes menu when clicking outside', () => {
    render(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        isGroupChat={false}
      />
    );

    const optionsButton = screen.getByLabelText('Chat options');
    fireEvent.click(optionsButton);

    expect(screen.getByText('View Profile')).toBeInTheDocument();

    // Click the backdrop
    const backdrop = document.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    expect(screen.queryByText('View Profile')).not.toBeInTheDocument();
  });

  it('renders avatar with online indicator', () => {
    const { container } = render(
      <ChatHeader
        chat={mockDirectChat}
        getChatTitle={mockGetChatTitle}
        getChatAvatar={mockGetChatAvatar}
        onlineStatus={{ online: true, lastSeen: new Date() }}
        isGroupChat={false}
      />
    );

    // Avatar should be rendered
    const avatar = container.querySelector('.relative.inline-block');
    expect(avatar).toBeInTheDocument();
  });
});
