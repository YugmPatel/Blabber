import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyActionsPage from './MyActionsPage';
import { emailMyActionsDigest, fetchMyActionsDigestPreference, updateMyActionsDigestPreference } from '@/api/client';
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
  fetchMyActionsDigestPreference: vi.fn(),
  respondPlanThisAssignment: vi.fn(),
  updateMyActionsDigestPreference: vi.fn(),
}));

const mockEmailMyActionsDigest = vi.mocked(emailMyActionsDigest);
const mockFetchMyActionsDigestPreference = vi.mocked(fetchMyActionsDigestPreference);
const mockUpdateMyActionsDigestPreference = vi.mocked(updateMyActionsDigestPreference);
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
    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: vi.fn(() => ({
        resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' }),
      })),
    });
    mockFetchMyActionsDigestPreference.mockResolvedValue({
      preference: {
        enabled: false,
        hourLocal: 9,
        timezone: 'UTC',
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    });
    mockUpdateMyActionsDigestPreference.mockResolvedValue({
      preference: {
        enabled: true,
        hourLocal: 9,
        timezone: 'UTC',
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    });
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the email digest action', () => {
    renderPage();

    const button = screen.getByRole('button', { name: 'Email me my Actions' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('w-full');
    expect(button).toHaveClass('sm:w-auto');
  });

  it('renders the Daily digest toggle disabled by default', async () => {
    renderPage();

    const toggle = await screen.findByRole('checkbox', { name: 'Daily digest' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Get one email each morning when you have open Actions.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Daily digest time' })).toHaveValue('9');
  });

  it('turns on Daily digest with the selected hour and timezone', async () => {
    renderPage();

    const toggle = await screen.findByRole('checkbox', { name: 'Daily digest' });
    fireEvent.click(toggle);

    await waitFor(() => expect(mockUpdateMyActionsDigestPreference.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      enabled: true,
      hourLocal: 9,
      timezone: 'America/Los_Angeles',
    })));
    expect(await screen.findByText('Daily Actions digest turned on.')).toBeInTheDocument();
  });

  it('turns off Daily digest when already enabled', async () => {
    mockFetchMyActionsDigestPreference.mockResolvedValue({
      preference: {
        enabled: true,
        hourLocal: 10,
        timezone: 'America/Los_Angeles',
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    });
    mockUpdateMyActionsDigestPreference.mockResolvedValue({
      preference: {
        enabled: false,
        hourLocal: 10,
        timezone: 'America/Los_Angeles',
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    });
    renderPage();

    const toggle = await screen.findByRole('checkbox', { name: 'Daily digest' });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);

    await waitFor(() => expect(mockUpdateMyActionsDigestPreference.mock.calls[0]?.[0]).toEqual({
      enabled: false,
      hourLocal: 10,
      timezone: 'America/Los_Angeles',
    }));
    expect(await screen.findByText('Daily Actions digest turned off.')).toBeInTheDocument();
  });

  it('updates the Daily digest time', async () => {
    renderPage();

    const selector = await screen.findByRole('combobox', { name: 'Daily digest time' });
    fireEvent.change(selector, { target: { value: '10' } });

    await waitFor(() => expect(mockUpdateMyActionsDigestPreference.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      enabled: false,
      hourLocal: 10,
      timezone: 'America/Los_Angeles',
    })));
  });

  it('shows an error when Daily digest preference update fails', async () => {
    mockUpdateMyActionsDigestPreference.mockRejectedValue(new Error('nope'));
    renderPage();

    const toggle = await screen.findByRole('checkbox', { name: 'Daily digest' });
    fireEvent.click(toggle);

    expect(await screen.findByText('Unable to update daily digest right now.')).toBeInTheDocument();
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
