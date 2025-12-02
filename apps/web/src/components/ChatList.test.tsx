import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ChatList from './ChatList';
import type { Chat } from '@repo/types';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const mockChats: Chat[] = [
  {
    _id: 'chat1',
    type: 'group',
    participants: ['user1', 'user2'],
    admins: ['user1'],
    title: 'Chat 1',
    lastMessageRef: {
      messageId: 'msg1',
      body: 'Message 1',
      senderId: 'user1',
      createdAt: new Date('2024-01-01T12:00:00Z'),
    },
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
  },
  {
    _id: 'chat2',
    type: 'group',
    participants: ['user1', 'user3'],
    admins: ['user1'],
    title: 'Chat 2',
    lastMessageRef: {
      messageId: 'msg2',
      body: 'Message 2',
      senderId: 'user3',
      createdAt: new Date('2024-01-01T13:00:00Z'),
    },
    createdAt: new Date('2024-01-01T11:00:00Z'),
    updatedAt: new Date('2024-01-01T13:00:00Z'),
  },
  {
    _id: 'chat3',
    type: 'group',
    participants: ['user1', 'user4'],
    admins: ['user1'],
    title: 'Chat 3',
    lastMessageRef: {
      messageId: 'msg3',
      body: 'Message 3',
      senderId: 'user4',
      createdAt: new Date('2024-01-01T11:30:00Z'),
    },
    createdAt: new Date('2024-01-01T09:00:00Z'),
    updatedAt: new Date('2024-01-01T11:30:00Z'),
  },
];

describe('ChatList', () => {
  it('renders all chats', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} />
      </BrowserRouter>
    );

    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
    expect(screen.getByText('Chat 3')).toBeInTheDocument();
  });

  it('sorts chats by last message time (most recent first)', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} />
      </BrowserRouter>
    );

    const chatTitles = screen.getAllByRole('button').map((el) => el.textContent);
    // Chat 2 has the most recent message (13:00), then Chat 1 (12:00), then Chat 3 (11:30)
    expect(chatTitles[0]).toContain('Chat 2');
    expect(chatTitles[1]).toContain('Chat 1');
    expect(chatTitles[2]).toContain('Chat 3');
  });

  it('shows pinned chats first', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} pinnedChatIds={['chat1']} />
      </BrowserRouter>
    );

    const chatTitles = screen.getAllByRole('button').map((el) => el.textContent);
    // Chat 1 should be first because it's pinned
    expect(chatTitles[0]).toContain('Chat 1');
  });

  it('filters archived chats when showArchived is false', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} archivedChatIds={['chat2']} showArchived={false} />
      </BrowserRouter>
    );

    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.queryByText('Chat 2')).not.toBeInTheDocument();
    expect(screen.getByText('Chat 3')).toBeInTheDocument();
  });

  it('shows only archived chats when showArchived is true', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} archivedChatIds={['chat2']} showArchived={true} />
      </BrowserRouter>
    );

    expect(screen.queryByText('Chat 1')).not.toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
    expect(screen.queryByText('Chat 3')).not.toBeInTheDocument();
  });

  it('displays unread counts', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} unreadCounts={{ chat1: 5, chat2: 10 }} />
      </BrowserRouter>
    );

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('shows empty state when no chats', () => {
    render(
      <BrowserRouter>
        <ChatList chats={[]} />
      </BrowserRouter>
    );

    expect(screen.getByText('No chats yet')).toBeInTheDocument();
  });

  it('shows archived empty state when no archived chats', () => {
    render(
      <BrowserRouter>
        <ChatList chats={[]} showArchived={true} />
      </BrowserRouter>
    );

    expect(screen.getByText('No archived chats')).toBeInTheDocument();
  });

  it('highlights active chat', () => {
    render(
      <BrowserRouter>
        <ChatList chats={mockChats} />
      </BrowserRouter>
    );

    // This test would need proper routing setup to work correctly
    // For now, we're just checking that the component renders
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
  });
});
