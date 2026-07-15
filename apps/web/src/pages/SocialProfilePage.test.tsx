import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SocialProfilePage, { ProfileCover, ProfileReelCard } from './SocialProfilePage';
import * as api from '@/api/client';
import type { ReelItem } from '@/api/client';
import { createTestQueryClient } from '@/test/query-test-utils';

vi.mock('@/components/Sidebar', () => ({ default: () => <aside aria-label="Sidebar" /> }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'viewer_1', name: 'Viewer', username: 'viewer', email: 'viewer@example.com' },
  }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    fetchAuthorizedObjectUrl: vi.fn(),
    fetchCommunities: vi.fn(),
    fetchProfileByHandle: vi.fn(),
    fetchProfileFollowers: vi.fn(),
    fetchProfileFollowing: vi.fn(),
    fetchProfilePosts: vi.fn(),
    fetchProfileReels: vi.fn(),
    fetchSavedPosts: vi.fn(),
    followProfile: vi.fn(),
    normalizeMediaUrl: vi.fn((url?: string | null) => url || undefined),
    reelPosterUrl: vi.fn((reelId: string) => `/api/reels/${reelId}/poster`),
    unfollowProfile: vi.fn(),
    cancelFollowRequest: vi.fn(),
  };
});

const reel: ReelItem = {
  id: 'reel_1',
  caption: 'Demo reel',
  visibility: 'public',
  topics: [],
  processingStatus: 'ready',
  publishState: 'published',
  durationSeconds: 8,
  width: 720,
  height: 1280,
  posterUrl: '/api/reels/reel_1/poster',
  thumbnailUrl: '/api/reels/reel_1/poster',
  reactionCounts: { like: 3 },
  commentCount: 2,
  publishedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

const post = {
  id: 'post_1',
  author: {
    id: 'studyhub',
    name: 'Study Hub',
    handle: 'studyhub',
    displayHandle: '@studyhub',
    avatarUrl: null,
  },
  body: 'A public post',
  visibility: 'public' as const,
  media: [],
  commentCount: 0,
  reactionCounts: {},
  myReaction: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  editedAt: null,
  canEdit: false,
  canDelete: false,
};

function mockProfilePageData() {
  vi.mocked(api.fetchAuthorizedObjectUrl).mockResolvedValue('blob:poster');
  vi.mocked(api.fetchProfileByHandle).mockResolvedValue({
    name: 'Study Hub',
    handle: 'studyhub',
    displayHandle: '@studyhub',
    avatarUrl: null,
    profileBannerUrl: null,
    profileBannerPositionY: 50,
    bio: 'Demo profile',
    website: null,
    visibility: 'public',
    relationship: 'none',
    counts: { followers: 0, following: 0 },
  });
  vi.mocked(api.fetchProfilePosts).mockResolvedValue({ posts: [post], nextCursor: null });
  vi.mocked(api.fetchProfileReels).mockResolvedValue({ reels: [reel], nextCursor: null, locked: false });
  vi.mocked(api.fetchProfileFollowers).mockResolvedValue({ users: [], nextCursor: null });
  vi.mocked(api.fetchProfileFollowing).mockResolvedValue({ users: [], nextCursor: null });
  vi.mocked(api.fetchCommunities).mockResolvedValue({ communities: [], pending: [] });
  vi.mocked(api.fetchSavedPosts).mockResolvedValue({ savedPosts: [], nextCursor: null });
}

function renderSocialProfilePage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/p/studyhub']}>
        <Routes>
          <Route path="/p/:handle" element={<SocialProfilePage />} />
          <Route path="/reels/:reelId" element={<div>Reel detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProfileReelCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('renders an authenticated poster image when available and still opens the reel', async () => {
    vi.mocked(api.fetchAuthorizedObjectUrl).mockResolvedValue('blob:poster');
    const onOpen = vi.fn();

    const { container } = render(<ProfileReelCard reel={reel} onOpen={onOpen} />);

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:poster'));
    fireEvent.click(screen.getByRole('button', { name: /demo reel/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps the gradient fallback when the poster is unavailable', async () => {
    vi.mocked(api.fetchAuthorizedObjectUrl).mockRejectedValue(new Error('poster unavailable'));

    const { container } = render(<ProfileReelCard reel={{ ...reel, posterUrl: null, thumbnailUrl: null }} onOpen={vi.fn()} />);

    await waitFor(() => expect(api.fetchAuthorizedObjectUrl).toHaveBeenCalledWith('/api/reels/reel_1/poster'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Demo reel')).toBeInTheDocument();
  });
});

describe('ProfileCover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('renders the saved vertical banner position', async () => {
    vi.mocked(api.fetchAuthorizedObjectUrl).mockResolvedValue('blob:banner');
    const { container } = render(<ProfileCover coverUrl="/api/media/local/banner" positionY={72} />);

    const image = await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'blob:banner');
      return img as HTMLImageElement;
    });
    expect(image.style.objectPosition).toBe('center 72%');
  });
});

describe('SocialProfilePage stat cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    });
    mockProfilePageData();
  });

  it('clicking Reels and Posts stats switches the selected tab', async () => {
    renderSocialProfilePage();

    await screen.findByText('Study Hub');
    fireEvent.click(await screen.findByRole('button', { name: /1\s*Reels/i }));
    expect(await screen.findByText('Demo reel')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /1\s*Posts/i }));
    expect(await screen.findByText('A public post')).toBeInTheDocument();
  });

  it('clicking Followers stat opens an empty followers modal', async () => {
    renderSocialProfilePage();

    await screen.findByText('Study Hub');
    fireEvent.click(screen.getByRole('button', { name: /0\s*Followers/i }));

    expect(await screen.findByRole('dialog', { name: 'Followers' })).toBeInTheDocument();
    expect(await screen.findByText('No followers yet.')).toBeInTheDocument();
  });

  it('clicking Following stat opens an empty following modal', async () => {
    renderSocialProfilePage();

    await screen.findByText('Study Hub');
    fireEvent.click(screen.getByRole('button', { name: /0\s*Following/i }));

    expect(await screen.findByRole('dialog', { name: 'Following' })).toBeInTheDocument();
    expect(await screen.findByText('Not following anyone yet.')).toBeInTheDocument();
  });
});
