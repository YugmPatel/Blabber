import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ReelsPage from './ReelsPage';
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
  return {
    ...actual,
    createReelComment: vi.fn(),
    createReelEventToken: vi.fn(),
    createReelPlaybackSession: vi.fn(),
    fetchAuthorizedObjectUrl: vi.fn(),
    fetchReelComments: vi.fn(),
    fetchReelsBrowse: vi.fn(),
    fetchReelsForYou: vi.fn(),
    muteReelCreator: vi.fn(),
    normalizeMediaUrl: vi.fn((url?: string | null) => url || undefined),
    notInterestedReel: vi.fn(),
    recordReelEvent: vi.fn(),
    refreshReelsForYou: vi.fn(),
    removeReelReaction: vi.fn(),
    reportReel: vi.fn(),
    saveReel: vi.fn(),
    setReelReaction: vi.fn(),
    unsaveReel: vi.fn(),
  };
});

const now = '2026-07-20T12:00:00.000Z';

function reel(id: string, caption: string, overrides: Partial<ReelItem> = {}): ReelItem {
  return {
    id,
    caption,
    visibility: 'public',
    topics: [],
    processingStatus: 'ready',
    publishState: 'published',
    durationSeconds: 9,
    width: 720,
    height: 1280,
    posterUrl: `/api/reels/${id}/poster`,
    thumbnailUrl: `/api/reels/${id}/poster`,
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

function mockPlayableSessions() {
  vi.mocked(api.createReelPlaybackSession).mockImplementation(async (reelId: string) => ({
    manifestUrl: `/api/reels/playback/${reelId}/manifest`,
    fallbackUrl: `/api/reels/playback/${reelId}/fallback`,
    posterUrl: `/api/reels/playback/${reelId}/poster`,
    expiresAt: now,
  }));
  vi.mocked(api.fetchAuthorizedObjectUrl).mockImplementation(async (url?: string | null) => {
    if (!url) return undefined;
    return `blob:${url}`;
  });
}

function mockReels(reels: ReelItem[]) {
  vi.mocked(api.fetchReelsForYou).mockResolvedValue({ reels, nextCursor: null, personalized: true, message: null });
  vi.mocked(api.fetchReelsBrowse).mockResolvedValue({ reels, nextCursor: null });
}

function renderReelsPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reels']}>
        <ReelsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReelsPage playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayableSessions();
    vi.mocked(api.createReelEventToken).mockResolvedValue({ eventToken: 'event-token', expiresInSeconds: 300 });
    vi.mocked(api.fetchReelComments).mockResolvedValue({ comments: [], nextCursor: null });
    vi.mocked(api.recordReelEvent).mockResolvedValue({ recorded: true });
    vi.mocked(api.refreshReelsForYou).mockResolvedValue({ cursor: 'next' });
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('renders a valid playable reel without the unavailable state', async () => {
    mockReels([reel('reel-a', 'Playable reel')]);

    const { container } = renderReelsPage();

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/reel-a/fallback'));
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('does not mark a valid reel unavailable when the poster is missing', async () => {
    mockReels([reel('reel-no-poster', 'No poster reel', { posterUrl: null, thumbnailUrl: null })]);

    const { container } = renderReelsPage();

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/reel-no-poster/fallback'));
    expect(api.fetchAuthorizedObjectUrl).toHaveBeenCalledWith('/api/reels/playback/reel-no-poster/fallback');
    expect(api.fetchAuthorizedObjectUrl).not.toHaveBeenCalledWith('/api/reels/playback/reel-no-poster/poster');
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('refreshes playback after a transient video error instead of permanently failing', async () => {
    mockReels([reel('reel-refresh', 'Refreshable reel')]);
    vi.mocked(api.createReelPlaybackSession)
      .mockResolvedValueOnce({
        manifestUrl: '/api/reels/playback/session-1/manifest',
        fallbackUrl: '/api/reels/playback/session-1/fallback',
        posterUrl: '/api/reels/playback/session-1/poster',
        expiresAt: now,
      })
      .mockResolvedValueOnce({
        manifestUrl: '/api/reels/playback/session-2/manifest',
        fallbackUrl: '/api/reels/playback/session-2/fallback',
        posterUrl: '/api/reels/playback/session-2/poster',
        expiresAt: now,
      });

    const { container } = renderReelsPage();
    const video = await waitFor(() => {
      const element = container.querySelector('video');
      expect(element).toHaveAttribute('src', 'blob:/api/reels/playback/session-1/fallback');
      return element as HTMLVideoElement;
    });

    fireEvent.error(video);

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/session-2/fallback'));
    expect(api.createReelPlaybackSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('scopes a failed reel to its id and clears the message when a valid suggested reel is selected', async () => {
    mockReels([
      reel('reel-bad', 'Broken reel'),
      reel('reel-good', 'Valid suggested reel'),
    ]);
    vi.mocked(api.createReelPlaybackSession).mockImplementation(async (reelId: string) => ({
      manifestUrl: `/api/reels/playback/${reelId}/manifest`,
      fallbackUrl: `/api/reels/playback/${reelId}/fallback`,
      posterUrl: `/api/reels/playback/${reelId}/poster`,
      expiresAt: now,
    }));
    vi.mocked(api.fetchAuthorizedObjectUrl).mockImplementation(async (url?: string | null) => {
      if (url?.includes('reel-bad/fallback')) throw new Error('expired session');
      if (!url) return undefined;
      return `blob:${url}`;
    });

    const { container } = renderReelsPage();

    await waitFor(() => expect(screen.getByText('This Reel is unavailable.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /valid suggested reel/i }));

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/reel-good/fallback'));
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('selecting a suggested reel updates the active player source', async () => {
    mockReels([
      reel('reel-first', 'First reel'),
      reel('reel-second', 'Second reel'),
    ]);

    const { container } = renderReelsPage();

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/reel-first/fallback'));
    fireEvent.click(screen.getByRole('button', { name: /second reel/i }));

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/reel-second/fallback'));
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('renders suggested reel poster images when available without creating playback sessions for the rail', async () => {
    mockReels([
      reel('reel-first', 'First reel'),
      reel('reel-second', 'Second reel'),
      reel('reel-third', 'Third reel'),
    ]);

    renderReelsPage();

    await waitFor(() => expect(screen.getByAltText('Second reel cover')).toHaveAttribute('src', 'blob:/api/reels/reel-second/poster'));
    await waitFor(() => expect(screen.getByAltText('Third reel cover')).toHaveAttribute('src', 'blob:/api/reels/reel-third/poster'));
    expect(api.createReelPlaybackSession).toHaveBeenCalledTimes(1);
  });

  it('falls back cleanly for a suggested reel without a poster', async () => {
    mockReels([
      reel('reel-first', 'First reel'),
      reel('reel-no-thumb', 'No thumb', { posterUrl: null, thumbnailUrl: null }),
    ]);

    renderReelsPage();

    await waitFor(() => expect(api.createReelPlaybackSession).toHaveBeenCalledTimes(1));
    expect(screen.queryByAltText('No thumb cover')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no thumb/i })).toBeInTheDocument();
  });

  it('expands and collapses Suggested Reels from the View all button', async () => {
    mockReels([
      reel('reel-1', 'Reel 1'),
      reel('reel-2', 'Reel 2'),
      reel('reel-3', 'Reel 3'),
      reel('reel-4', 'Reel 4'),
      reel('reel-5', 'Reel 5'),
      reel('reel-6', 'Reel 6'),
      reel('reel-7', 'Reel 7'),
    ]);

    renderReelsPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /view all/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /reel 7/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view all/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /reel 7/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
  });

  it('renders an empty reels list without a broken player', async () => {
    mockReels([]);

    const { container } = renderReelsPage();

    await waitFor(() => expect(screen.getByText('No reels yet. Check back soon or create the first one.')).toBeInTheDocument());
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('renders unavailable for an invalid reel without crashing', async () => {
    mockReels([reel('reel-invalid', 'Invalid reel')]);
    vi.mocked(api.fetchAuthorizedObjectUrl).mockRejectedValue(new Error('missing media'));

    renderReelsPage();

    await waitFor(() => expect(screen.getByText('This Reel is unavailable.')).toBeInTheDocument());
    expect(screen.getByText('Invalid reel')).toBeInTheDocument();
  });
});
