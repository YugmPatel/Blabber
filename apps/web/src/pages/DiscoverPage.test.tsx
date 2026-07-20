import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DiscoverPage from './DiscoverPage';
import * as api from '@/api/client';
import type { ReelItem } from '@/api/client';
import { createTestQueryClient } from '@/test/query-test-utils';

vi.mock('@/components/Avatar', () => ({
  default: ({ alt }: { alt?: string }) => <span data-testid="avatar">{alt}</span>,
}));

vi.mock('@/components/Sidebar', () => ({
  default: () => <aside aria-label="Sidebar" />,
}));

vi.mock('@/components/PlanThisDialog', () => ({
  default: ({ open }: { open: boolean }) => open ? <div>Plan This</div> : null,
}));

vi.mock('@/components/ShareToChat', () => ({
  ShareToChatPanel: () => <div>Share to chat</div>,
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  const noop = vi.fn();
  return {
    ...actual,
    createReelComment: noop,
    createReelPlaybackSession: vi.fn(),
    fetchAuthorizedObjectUrl: vi.fn(),
    fetchDiscoveryCommunities: vi.fn(),
    fetchDiscoveryCreators: vi.fn(),
    fetchDiscoveryPosts: vi.fn(),
    fetchDiscoveryPreferences: vi.fn(),
    fetchDiscoveryTopics: vi.fn(),
    fetchForYou: vi.fn(),
    fetchForYouExplanation: noop,
    fetchPost: noop,
    fetchReel: vi.fn(),
    fetchReelComments: vi.fn(),
    fetchReelsBrowse: vi.fn(),
    followDiscoveryTopic: noop,
    followProfile: noop,
    muteDiscoveryCommunity: noop,
    muteDiscoveryCreator: noop,
    muteDiscoveryTopic: noop,
    normalizeMediaUrl: vi.fn((url?: string | null) => url || undefined),
    notInterestedDiscoveryPost: noop,
    notInterestedReel: noop,
    recordDiscoveryEvent: vi.fn().mockResolvedValue({ recorded: true }),
    recordForYouEvent: vi.fn().mockResolvedValue({ recorded: true }),
    refreshForYou: noop,
    reelPosterUrl: vi.fn((reelId: string) => `/api/reels/${reelId}/poster`),
    removePostReaction: noop,
    removeReelReaction: noop,
    repostPost: noop,
    reportReel: noop,
    savePost: noop,
    saveReel: noop,
    setPostReaction: noop,
    setReelReaction: noop,
    undoRepostPost: noop,
    unfollowDiscoveryTopic: noop,
    unfollowProfile: noop,
    unmuteDiscoveryTopic: noop,
    unsavePost: noop,
    unsaveReel: noop,
    muteReelCreator: noop,
  };
});

const now = '2026-07-20T12:00:00.000Z';

function reel(id: string, overrides: Partial<ReelItem> = {}): ReelItem {
  return {
    id,
    caption: 'Demo discover reel',
    visibility: 'public',
    topics: [],
    processingStatus: 'ready',
    publishState: 'published',
    durationSeconds: 9,
    width: 720,
    height: 1280,
    posterUrl: null,
    thumbnailUrl: null,
    author: { name: 'Food Finds', handle: 'foodfinds', displayHandle: '@foodfinds', avatarUrl: null },
    reactionCounts: {},
    myReaction: null,
    commentCount: 0,
    saved: false,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockDiscoverData(reels: ReelItem[] = []) {
  vi.mocked(api.fetchDiscoveryTopics).mockResolvedValue([]);
  vi.mocked(api.fetchDiscoveryPreferences).mockResolvedValue({
    personalizedDiscoveryEnabled: true,
    followedTopics: [],
    mutedTopics: [],
    mutedCreatorCount: 0,
    mutedCommunityCount: 0,
    hiddenPostCount: 0,
  });
  vi.mocked(api.fetchDiscoveryCreators).mockResolvedValue({ creators: [], nextCursor: null });
  vi.mocked(api.fetchDiscoveryPosts).mockResolvedValue({ posts: [], nextCursor: null });
  vi.mocked(api.fetchReelsBrowse).mockResolvedValue({ reels, nextCursor: null });
  vi.mocked(api.fetchDiscoveryCommunities).mockResolvedValue({ communities: [], nextCursor: null });
  vi.mocked(api.fetchForYou).mockResolvedValue({
    posts: [],
    nextCursor: null,
    personalized: true,
    rankingModelVersion: 'test',
    message: null,
  });
}

function renderDiscoverPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/discover?tab=browse']}>
        <DiscoverPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('renders the browse empty state cleanly', async () => {
    mockDiscoverData();

    renderDiscoverPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Discover' })).toBeInTheDocument());
    expect(screen.getByText('No discoverable content is available for this topic yet.')).toBeInTheDocument();
  });

  it('renders discovered reel thumbnails from the reel payload', async () => {
    mockDiscoverData([reel('reel-with-poster', { posterUrl: '/api/reels/reel-with-poster/poster', thumbnailUrl: '/api/reels/reel-with-poster/poster' })]);
    vi.mocked(api.fetchAuthorizedObjectUrl).mockImplementation(async (url?: string | null) => url ? `blob:${url}` : undefined);

    const { container } = renderDiscoverPage();

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:/api/reels/reel-with-poster/poster'));
    expect(api.createReelPlaybackSession).not.toHaveBeenCalled();
  });

  it('opens a discovered reel with playable media even when the poster is missing', async () => {
    const item = reel('reel-discover');
    mockDiscoverData([item]);
    vi.mocked(api.fetchReel).mockResolvedValue(item);
    vi.mocked(api.fetchReelComments).mockResolvedValue({ comments: [], nextCursor: null });
    vi.mocked(api.createReelPlaybackSession).mockResolvedValue({
      manifestUrl: '/api/reels/playback/discover-session/manifest',
      fallbackUrl: '/api/reels/playback/discover-session/fallback',
      posterUrl: '/api/reels/playback/discover-session/poster',
      expiresAt: now,
    });
    vi.mocked(api.fetchAuthorizedObjectUrl).mockImplementation(async (url?: string | null) => url ? `blob:${url}` : undefined);

    const { container } = renderDiscoverPage();

    await waitFor(() => expect(screen.getByText('Demo discover reel')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Reel')[0].closest('button')!);

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/discover-session/fallback'));
    expect(screen.queryByText('Reel unavailable.')).not.toBeInTheDocument();
    expect(api.fetchAuthorizedObjectUrl).not.toHaveBeenCalledWith('/api/reels/playback/discover-session/poster');
  });
});
