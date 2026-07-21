import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyActionsPage from './MyActionsPage';
import { emailMyActionsDigest } from '@/api/client';
import { useMyActions } from '@/hooks/useChatActions';

vi.mock('@/components/ui/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/ui/PageHeader', () => ({
  default: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  ),
}));

vi.mock('@/components/ui/SegmentedTabs', () => ({
  default: ({ options }: { options: Array<{ value: string; label: string }> }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} type="button">
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/Avatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

vi.mock('@/components/SourceEvidence', () => ({
  default: () => null,
}));

vi.mock('@/components/ChatActionsPanel', () => ({
  ActionForm: () => <div>Action form</div>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'user-1', username: 'yugm', email: 'yugm@example.com', name: 'Yugm Patel' },
  }),
}));

vi.mock('@/hooks/useChatActions', () => ({
  chatActionKeys: {
    mine: () => ['chat-actions', 'mine'],
  },
  useMyActions: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  apiErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
  emailMyActionsDigest: vi.fn(),
  respondPlanThisAssignment: vi.fn(),
}));

const mockEmailMyActionsDigest = vi.mocked(emailMyActionsDigest);
const mockUseMyActions = vi.mocked(useMyActions);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MyActionsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MyActionsPage email digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMyActions.mockReturnValue({
      actions: [
        {
          id: 'action-1',
          chatId: 'chat-1',
          type: 'task',
          title: 'Book elevator',
          status: 'open',
          assignedTo: { userId: 'user-1', name: 'Yugm' },
          createdBy: { userId: 'user-2', name: 'Friend' },
          sourceMessageIds: [],
        },
      ],
      isLoading: false,
      error: null,
      createAction: vi.fn(),
      updateAction: vi.fn(),
      updateActionStatus: vi.fn(),
      deleteAction: vi.fn(),
      isCreatingAction: false,
      isUpdating: false,
      updateError: null,
    });
  });

  it('renders the email digest action', () => {
    renderPage();

    const button = screen.getByRole('button', { name: 'Email me my Actions' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('w-full');
    expect(button).toHaveClass('sm:w-auto');
  });

  it('disables the digest button while sending', async () => {
    let resolveDigest: ((value: { sent: boolean; count: number; message: string }) => void) | undefined;
    mockEmailMyActionsDigest.mockReturnValue(new Promise((resolve) => {
      resolveDigest = resolve;
    }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Email me my Actions' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled());
    await act(async () => {
      resolveDigest?.({ sent: true, count: 1, message: 'Actions digest sent to your email.' });
    });
  });

  it('shows success when the digest is sent', async () => {
    mockEmailMyActionsDigest.mockResolvedValue({ sent: true, count: 1, message: 'Actions digest sent to your email.' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Email me my Actions' }));

    expect(await screen.findByText('Actions digest sent to your email.')).toBeInTheDocument();
  });

  it('shows the no-actions response without treating it as a failure', async () => {
    mockEmailMyActionsDigest.mockResolvedValue({ sent: false, count: 0, message: 'No open Actions to email.' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Email me my Actions' }));

    expect(await screen.findByText('No open Actions to email.')).toBeInTheDocument();
  });

  it('shows an error when the digest request fails', async () => {
    mockEmailMyActionsDigest.mockRejectedValue(new Error('SMTP unavailable'));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Email me my Actions' }));

    expect(await screen.findByText('Could not send digest. Please try again.')).toBeInTheDocument();
  });
});
