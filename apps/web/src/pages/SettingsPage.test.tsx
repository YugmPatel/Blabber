import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from './SettingsPage';
import {
  apiClient,
  fetchVeyraScopeCandidates,
  fetchVeyraSettings,
  grantVeyraScope,
  revokeVeyraScope,
  updateVeyraSettings,
} from '@/api/client';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'user1', username: 'jordan', email: 'jordan@example.com', name: 'Jordan Lee' },
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUpdateProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useMessages', () => ({
  useSavedMessages: () => ({ data: { pages: [] }, isLoading: false, isError: false }),
}));

vi.mock('@/components/CameraModal', () => ({
  default: () => null,
}));

vi.mock('./SavedMessagesPage', () => ({
  SavedContentSection: () => <div>Saved content placeholder</div>,
}));

vi.mock('@/api/client', () => {
  const noop = vi.fn();
  return {
    apiClient: { get: vi.fn(), patch: vi.fn(), delete: vi.fn(), post: vi.fn() },
    apiErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
    normalizeMediaUrl: (url?: string | null) => url ?? undefined,
    getAccessToken: vi.fn(),
    approveFollowRequest: noop,
    blockUser: noop,
    declineFollowRequest: noop,
    downloadDataExport: noop,
    fetchBlockedUsers: noop,
    fetchAccountStatus: noop,
    fetchDataExports: noop,
    fetchDeviceSessions: noop,
    fetchIncomingFollowRequests: noop,
    fetchMyProfile: noop,
    fetchMyReports: noop,
    fetchProfilePosts: noop,
    fetchProfileReels: noop,
    fetchSavedPosts: noop,
    fetchDiscoveryPreferences: noop,
    fetchDiscoveryTopics: noop,
    clearDiscoveryPersonalization: noop,
    updateCreatorDiscovery: noop,
    updateDiscoveryPreferences: noop,
    updateProfileHandle: noop,
    updateSocialProfile: noop,
    requestAccountDeletion: noop,
    requestDataExport: noop,
    requestEmailChange: noop,
    requestPasswordReset: noop,
    resendEmailVerification: noop,
    logoutOtherDeviceSessions: noop,
    revokeDeviceSession: noop,
    unblockUser: noop,
    fetchVeyraScopeCandidates: vi.fn(),
    fetchVeyraSettings: vi.fn(),
    grantVeyraScope: vi.fn(),
    revokeVeyraScope: vi.fn(),
    updateVeyraSettings: vi.fn(),
  };
});

const mockApiClient = vi.mocked(apiClient);
const mockFetchVeyraSettings = vi.mocked(fetchVeyraSettings);
const mockFetchVeyraScopeCandidates = vi.mocked(fetchVeyraScopeCandidates);
const mockGrantVeyraScope = vi.mocked(grantVeyraScope);
const mockRevokeVeyraScope = vi.mocked(revokeVeyraScope);
const mockUpdateVeyraSettings = vi.mocked(updateVeyraSettings);

const userSettings = {
  readReceiptsEnabled: true,
  presenceVisible: true,
  lastSeenVisible: true,
  incomingCallsEnabled: true,
  themePreference: 'light',
  chatIntelligenceEnabled: true,
  momentArchiveEnabled: true,
  messagePrivacy: 'everyone',
  groupInvitePrivacy: 'everyone',
};

const emptyVeyraSettings = {
  enabled: true,
  voiceRepliesEnabled: true,
  accessMode: 'approved_spaces' as const,
  scopes: [] as Array<{ id: string; type: 'chat'; targetId: string; label: string; grantedAt: string }>,
  updatedAt: new Date().toISOString(),
};

const approvedScope = {
  id: 'chat:apartment',
  type: 'chat' as const,
  targetId: 'apartment',
  label: 'Apartment Hunt',
  grantedAt: new Date().toISOString(),
};

function renderSettingsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/settings?s=ai']}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function flushAsyncWork() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('SettingsPage AI Privacy / Veyra', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/api/users/settings/me') return Promise.resolve({ data: { settings: userSettings } });
      if (url === '/api/intelligence/availability') return Promise.resolve({ data: { status: 'available' } });
      return Promise.resolve({ data: {} });
    });
    mockApiClient.delete.mockResolvedValue({ data: {} });
    mockFetchVeyraSettings.mockResolvedValue({ settings: structuredClone(emptyVeyraSettings), globalAiEnabled: true });
    mockFetchVeyraScopeCandidates.mockResolvedValue([
      { type: 'chat', targetId: 'apartment', label: 'Apartment Hunt' },
      { type: 'chat', targetId: 'weekend', label: 'Weekend Crew' },
    ]);
    mockGrantVeyraScope.mockResolvedValue({ ...structuredClone(emptyVeyraSettings), scopes: [approvedScope] });
    mockRevokeVeyraScope.mockResolvedValue(structuredClone(emptyVeyraSettings));
    mockUpdateVeyraSettings.mockResolvedValue(structuredClone(emptyVeyraSettings));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds an approved space immediately from the mutation response without a hard refresh or stale settings refetch', async () => {
    renderSettingsPage();

    await screen.findByText('No spaces approved yet.');
    fireEvent.click(await screen.findByRole('button', { name: /add space/i }));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'chat:apartment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Apartment Hunt')).toBeInTheDocument();
    expect(screen.queryByText('No spaces approved yet.')).not.toBeInTheDocument();
    await flushAsyncWork();
    expect(screen.getAllByText('Approved')).toHaveLength(1);
    expect(mockGrantVeyraScope.mock.calls[0][0]).toEqual({ type: 'chat', targetId: 'apartment' });
    expect(mockFetchVeyraSettings).toHaveBeenCalledTimes(1);
  });

  it('removes an approved space immediately and keeps the row gone', async () => {
    mockFetchVeyraSettings.mockResolvedValue({
      settings: { ...structuredClone(emptyVeyraSettings), scopes: [approvedScope] },
      globalAiEnabled: true,
    });
    renderSettingsPage();

    expect(await screen.findByText('Apartment Hunt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.queryByText('Apartment Hunt')).not.toBeInTheDocument());
    expect(screen.getByText('No spaces approved yet.')).toBeInTheDocument();
    await flushAsyncWork();
    expect(mockRevokeVeyraScope.mock.calls[0][0]).toBe('chat:apartment');
    expect(mockFetchVeyraSettings).toHaveBeenCalledTimes(1);
  });

  it('updates full-access mode immediately without corrupting the approved-space list', async () => {
    mockFetchVeyraSettings.mockResolvedValue({
      settings: { ...structuredClone(emptyVeyraSettings), scopes: [approvedScope] },
      globalAiEnabled: true,
    });
    mockUpdateVeyraSettings.mockResolvedValue({
      ...structuredClone(emptyVeyraSettings),
      accessMode: 'full_access',
      scopes: [approvedScope],
    });
    renderSettingsPage();

    expect(await screen.findByText('Apartment Hunt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Full access to my Blabber/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enable full access' }));

    await waitFor(() => expect(screen.getByRole('radio', { name: /Full access to my Blabber/i })).toBeChecked());
    expect(screen.getByText('Apartment Hunt')).toBeInTheDocument();
    expect(mockUpdateVeyraSettings.mock.calls[0][0]).toEqual({ accessMode: 'full_access' });
  });
});
