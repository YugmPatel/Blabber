import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type React from 'react';
import Sidebar from './Sidebar';

const mockNavigate = vi.fn();
const mockLogout = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      _id: 'user1',
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User',
      avatarSource: 'none',
    },
    logout: mockLogout,
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/chats' }),
  };
});

const renderSidebar = (props: React.ComponentProps<typeof Sidebar> = {}) =>
  render(
    <BrowserRouter>
      <Sidebar {...props} />
    </BrowserRouter>
  );

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders brand and primary navigation', () => {
    renderSidebar();

    expect(screen.getByText('Blabber')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Chats' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My Actions' })).toBeInTheDocument();
  });

  it('starts a new conversation from the primary action', () => {
    const onNewConversation = vi.fn();
    renderSidebar({ onNewConversation });

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it('toggles collapsed state', () => {
    const onToggle = vi.fn();
    renderSidebar({ onToggle });

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('navigates to app sections', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calls' }));

    expect(mockNavigate).toHaveBeenCalledWith('/archived');
    expect(mockNavigate).toHaveBeenCalledWith('/saved');
    expect(mockNavigate).toHaveBeenCalledWith('/calls');
  });

  it('changes chat filter for groups', () => {
    const onChatFilterChange = vi.fn();
    renderSidebar({ onChatFilterChange });

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    expect(onChatFilterChange).toHaveBeenCalledWith('groups');
    expect(mockNavigate).toHaveBeenCalledWith('/chats');
  });

  it('renders collapsed icon-only controls', () => {
    renderSidebar({ collapsed: true });

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument();
    expect(screen.queryByText('New chat')).not.toBeInTheDocument();
  });
});
