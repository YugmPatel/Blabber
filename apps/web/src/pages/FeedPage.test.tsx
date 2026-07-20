import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import FeedPage from './FeedPage';
import * as api from '@/api/client';
import type { FeedPost } from '@/api/client';
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

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadMedia: vi.fn(),
    isUploading: false,
    error: null,
  }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  const noop = vi.fn();
  return {
    ...actual,
    createPost: noop,
    createPostComment: noop,
    deletePost: noop,
    fetchAuthorizedObjectUrl: vi.fn(),
    fetchDiscoveryTopics: vi.fn(),
    fetchFeed: vi.fn(),
    fetchMyProfile: vi.fn(),
    fetchPostComments: vi.fn(),
    followProfile: noop,
    normalizeMediaUrl: vi.fn((url?: string | null) => url || undefined),
    removePostReaction: noop,
    repostPost: noop,
    savePost: noop,
    setPostReaction: noop,
    undoRepostPost: noop,
    unfollowProfile: noop,
    unsavePost: noop,
    updatePostDiscovery: noop,
  };
});

const now = '2026-07-20T12:00:00.000Z';

const basePost: FeedPost = {
  id: 'post-1',
  author: {
    id: 'creator-1',
    name: 'Food Finds',
    handle: 'foodfinds',
    displayHandle: '@foodfinds',
    avatarUrl: null,
    relationship: 'none',
    profileVisibility: 'public',
  },
  body: 'Lunch plans',
  visibility: 'public',
  media: [],
  commentCount: 0,
  reactionCounts: {},
  myReaction: null,
  saved: false,
  reposted: false,
  canSave: true,
  canRepost: true,
  canShare: true,
  repost: null,
  createdAt: now,
  updatedAt: now,
  editedAt: null,
  canEdit: false,
  canDelete: false,
};

function renderFeedPage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/feed']}>
        <FeedPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FeedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchMyProfile).mockResolvedValue({
      name: 'Viewer',
      handle: 'viewer',
      displayHandle: '@viewer',
      avatarUrl: null,
      profileBannerUrl: null,
      profileBannerPositionY: 50,
      bio: null,
      website: null,
      visibility: 'public',
      relationship: 'self',
      counts: { followers: 0, following: 0 },
    });
    vi.mocked(api.fetchDiscoveryTopics).mockResolvedValue([]);
    vi.mocked(api.fetchPostComments).mockResolvedValue({ comments: [], nextCursor: null });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('renders the empty featured feed state cleanly', async () => {
    vi.mocked(api.fetchFeed).mockResolvedValue({ posts: [], nextCursor: null });

    renderFeedPage();

    await waitFor(() => expect(screen.getByText('No featured posts are available right now.')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Feed' })).toBeInTheDocument();
  });

  it('renders text posts as text and falls back for broken media', async () => {
    vi.mocked(api.fetchFeed).mockResolvedValue({
      posts: [{
        ...basePost,
        body: '<script>alert("xss")</script> wrapped text',
        media: [{ mediaId: 'media-1', type: 'image', url: '/api/media/local/missing.jpg' }],
      }],
      nextCursor: null,
    });
    vi.mocked(api.fetchAuthorizedObjectUrl).mockRejectedValue(new Error('missing image'));

    const { container } = renderFeedPage();

    await waitFor(() => expect(screen.getByText('<script>alert("xss")</script> wrapped text')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Image unavailable')).toBeInTheDocument());
    expect(container.querySelector('script')).toBeNull();
  });
});
