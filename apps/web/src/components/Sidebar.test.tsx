import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    resolvedTheme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/api/client', () => ({
  fetchMyProfile: vi.fn(),
  normalizeMediaUrl: (url?: string | null) => url ?? undefined,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/chats' }),
  };
});

const renderSidebar = (props: React.ComponentProps<typeof Sidebar> = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Sidebar {...props} />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders brand and primary navigation', () => {
    renderSidebar();

    expect(screen.getByText('Blabber')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My Actions' })).toBeInTheDocument();
  });

  it('starts a new conversation from the primary action', () => {
    const onNewConversation = vi.fn();
    renderSidebar({ onNewConversation });

    fireEvent.click(screen.getByRole('button', { name: 'New Convo' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Feed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calls' }));

    expect(mockNavigate).toHaveBeenCalledWith('/archived');
    expect(mockNavigate).toHaveBeenCalledWith('/feed');
    expect(mockNavigate).toHaveBeenCalledWith('/calls');
  });

  it('changes chat filter for groups', () => {
    const onChatFilterChange = vi.fn();
    renderSidebar({ onChatFilterChange });

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    expect(onChatFilterChange).toHaveBeenCalledWith('groups');
    expect(mockNavigate).toHaveBeenCalledWith('/chats?filter=groups');
  });

  it('renders collapsed icon-only controls', () => {
    renderSidebar({ collapsed: true });

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Convo' })).toBeInTheDocument();
    expect(screen.queryByText('New chat')).not.toBeInTheDocument();
  });
});
