import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReelPage from './ReelPage';
import * as api from '@/api/client';
import type { ReelItem } from '@/api/client';
import { createTestQueryClient } from '@/test/query-test-utils';

vi.mock('@/components/ShareToChat', () => ({
  default: () => <div>Share to chat</div>,
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  const noop = vi.fn();
  return {
    ...actual,
    createReelComment: noop,
    createReelEventToken: vi.fn(),
    createReelPlaybackSession: vi.fn(),
    deleteReel: noop,
    fetchAuthorizedObjectUrl: vi.fn(),
    fetchReel: vi.fn(),
    fetchReelComments: vi.fn(),
    recordReelEvent: vi.fn(),
    removeReelReaction: noop,
    reportReel: noop,
    saveReel: noop,
    setReelReaction: noop,
    unsaveReel: noop,
  };
});

const now = '2026-07-20T12:00:00.000Z';

function reel(overrides: Partial<ReelItem> = {}): ReelItem {
  return {
    id: 'reel-detail',
    caption: 'Direct reel',
    visibility: 'public',
    topics: [],
    processingStatus: 'ready',
    publishState: 'published',
    durationSeconds: 9,
    width: 720,
    height: 1280,
    posterUrl: '/api/reels/reel-detail/poster',
    thumbnailUrl: '/api/reels/reel-detail/poster',
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

function mockSession(token: string) {
  return {
    manifestUrl: `/api/reels/playback/${token}/manifest`,
    fallbackUrl: `/api/reels/playback/${token}/fallback`,
    posterUrl: `/api/reels/playback/${token}/poster`,
    expiresAt: now,
  };
}

function renderReelPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reels/reel-detail']}>
        <Routes>
          <Route path="/reels/:reelId" element={<ReelPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReelPage direct playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchReel).mockResolvedValue(reel());
    vi.mocked(api.fetchReelComments).mockResolvedValue({ comments: [], nextCursor: null });
    vi.mocked(api.createReelEventToken).mockResolvedValue({ eventToken: 'event-token', expiresInSeconds: 300 });
    vi.mocked(api.recordReelEvent).mockResolvedValue({ recorded: true });
    vi.mocked(api.createReelPlaybackSession).mockResolvedValue(mockSession('session-1'));
    vi.mocked(api.fetchAuthorizedObjectUrl).mockImplementation(async (url?: string | null) => url ? `blob:${url}` : undefined);
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('creates a playback session and clears loading on success', async () => {
    const { container } = renderReelPage();

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/session-1/fallback'));
    expect(screen.queryByText('Loading video...')).not.toBeInTheDocument();
    expect(screen.getByText('Direct reel')).toBeInTheDocument();
  });

  it('retries once on transient video error and uses the refreshed playback URL', async () => {
    vi.mocked(api.createReelPlaybackSession)
      .mockResolvedValueOnce(mockSession('session-1'))
      .mockResolvedValueOnce(mockSession('session-2'));

    const { container } = renderReelPage();
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

  it('does not let a broken poster block valid direct video playback', async () => {
    vi.mocked(api.fetchAuthorizedObjectUrl).mockImplementation(async (url?: string | null) => {
      if (url?.includes('/poster')) throw new Error('missing poster');
      return url ? `blob:${url}` : undefined;
    });

    const { container } = renderReelPage();

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:/api/reels/playback/session-1/fallback'));
    expect(screen.queryByText('This Reel is unavailable.')).not.toBeInTheDocument();
  });

  it('renders unavailable for an invalid direct reel without crashing', async () => {
    vi.mocked(api.fetchReel).mockRejectedValue(new Error('not found'));

    renderReelPage();

    await waitFor(() => expect(screen.getByText('This Reel is unavailable.')).toBeInTheDocument());
  });
});
