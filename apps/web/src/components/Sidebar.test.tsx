import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import type { Chat } from '@repo/types';

const mockChats: Chat[] = [
  {
    _id: 'chat1',
    type: 'group',
    participants: ['user1', 'user2'],
    admins: ['user1'],
    title: 'Team Meeting',
    lastMessageRef: {
      messageId: 'msg1',
      body: 'See you tomorrow',
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
    title: 'Project Discussion',
    lastMessageRef: {
      messageId: 'msg2',
      body: 'Great work on the project',
      senderId: 'user3',
      createdAt: new Date('2024-01-01T13:00:00Z'),
    },
    createdAt: new Date('2024-01-01T11:00:00Z'),
    updatedAt: new Date('2024-01-01T13:00:00Z'),
  },
];

vi.mock('../hooks/useChats', () => ({
  useChats: vi.fn(() => ({
    data: mockChats,
    isLoading: false,
    error: null,
  })),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
  };
});

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sidebar with header', () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    expect(screen.getByText('Chats')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    const searchInput = screen.getByPlaceholderText('Search chats...');
    expect(searchInput).toBeInTheDocument();
  });

  it('renders archive button', () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    const archiveButton = screen.getByLabelText('Show archived chats');
    expect(archiveButton).toBeInTheDocument();
  });

  it('displays all chats', async () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Team Meeting')).toBeInTheDocument();
      expect(screen.getByText('Project Discussion')).toBeInTheDocument();
    });
  });

  it('filters chats based on search query', async () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    const searchInput = screen.getByPlaceholderText('Search chats...');

    fireEvent.change(searchInput, { target: { value: 'Team' } });

    await waitFor(() => {
      expect(screen.getByText('Team Meeting')).toBeInTheDocument();
      expect(screen.queryByText('Project Discussion')).not.toBeInTheDocument();
    });
  });

  it('filters chats based on message content', async () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    const searchInput = screen.getByPlaceholderText('Search chats...');

    fireEvent.change(searchInput, { target: { value: 'project' } });

    await waitFor(() => {
      expect(screen.getByText('Project Discussion')).toBeInTheDocument();
      expect(screen.getByText('Great work on the project')).toBeInTheDocument();
    });
  });

  it('shows all chats when search is cleared', async () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    const searchInput = screen.getByPlaceholderText('Search chats...');

    fireEvent.change(searchInput, { target: { value: 'Team' } });

    await waitFor(() => {
      expect(screen.queryByText('Project Discussion')).not.toBeInTheDocument();
    });

    fireEvent.change(searchInput, { target: { value: '' } });

    await waitFor(() => {
      expect(screen.getByText('Team Meeting')).toBeInTheDocument();
      expect(screen.getByText('Project Discussion')).toBeInTheDocument();
    });
  });

  it('toggles archived view', async () => {
    render(<Sidebar />, { wrapper: createWrapper() });

    const archiveButton = screen.getByLabelText('Show archived chats');

    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Show active chats')).toBeInTheDocument();
    });

    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Show archived chats')).toBeInTheDocument();
    });
  });

  it('calls onMenuClick when menu button is clicked', () => {
    const onMenuClick = vi.fn();
    render(<Sidebar onMenuClick={onMenuClick} />, { wrapper: createWrapper() });

    const menuButton = screen.getByLabelText('Open menu');
    fireEvent.click(menuButton);

    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading state', async () => {
    const useChatsModule = await import('../hooks/useChats');
    vi.spyOn(useChatsModule, 'useChats').mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    } as any);

    render(<Sidebar />, { wrapper: createWrapper() });

    expect(screen.getByText('Loading chats...')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    const useChatsModule = await import('../hooks/useChats');
    vi.spyOn(useChatsModule, 'useChats').mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('Failed to load'),
    } as any);

    render(<Sidebar />, { wrapper: createWrapper() });

    expect(screen.getByText('Error loading chats')).toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    // Reset the mock to return the default data
    const useChatsModule = await import('../hooks/useChats');
    vi.spyOn(useChatsModule, 'useChats').mockReturnValue({
      data: mockChats,
      isLoading: false,
      error: null,
    } as any);

    render(<Sidebar />, { wrapper: createWrapper() });

    const searchInput = screen.getByPlaceholderText('Search chats...');

    fireEvent.change(searchInput, { target: { value: 'TEAM' } });

    await waitFor(() => {
      expect(screen.getByText('Team Meeting')).toBeInTheDocument();
    });
  });
});
