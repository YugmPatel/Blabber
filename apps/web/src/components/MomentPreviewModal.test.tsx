import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MomentPreviewModal from './MomentPreviewModal';
import { createTestQueryClient } from '@/test/query-test-utils';
import { apiClient, createMomentVideoPlaybackSession, fetchAuthorizedObjectUrl } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
  createMomentVideoPlaybackSession: vi.fn(),
  fetchAuthorizedObjectUrl: vi.fn(),
}));

function renderModal(momentId = 'moment-1') {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MomentPreviewModal momentId={momentId} onClose={() => {}} />
    </QueryClientProvider>
  );
}

describe('MomentPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:${blob.type || 'media'}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(createMomentVideoPlaybackSession).mockResolvedValue({ expiresAt: new Date().toISOString() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders original text Moment content', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        moment: {
          _id: 'moment-text',
          author: { _id: 'author-1', name: 'Devanshee' },
          type: 'text',
          textBody: 'Original campus update',
          createdAt: new Date().toISOString(),
        },
      },
    });

    renderModal('moment-text');

    expect(await screen.findByText('Original campus update')).toBeInTheDocument();
    expect(screen.getByText('Devanshee · Text Moment')).toBeInTheDocument();
  });

  it('renders original photo Moment media', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        moment: {
          _id: 'moment-photo',
          author: { _id: 'author-1', name: 'Deva' },
          type: 'image',
          caption: 'Photo caption',
          mediaUrl: '/api/moments/moment-photo/media',
          createdAt: new Date().toISOString(),
        },
      },
    });
    vi.mocked(fetchAuthorizedObjectUrl).mockResolvedValue('blob:photo');

    renderModal('moment-photo');

    const image = await screen.findByAltText('Photo caption');
    expect(image).toHaveAttribute('src', 'blob:photo');
    expect(screen.getByText('Photo caption')).toBeInTheDocument();
  });

  it('renders original audio Moment controls', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        moment: {
          _id: 'moment-audio',
          author: { _id: 'author-1', name: 'Deva' },
          type: 'audio',
          caption: 'Voice note',
          mediaUrl: '/api/moments/moment-audio/media',
          createdAt: new Date().toISOString(),
        },
      },
    });
    vi.mocked(fetchAuthorizedObjectUrl).mockResolvedValue('blob:audio');

    renderModal('moment-audio');

    await waitFor(() => expect(screen.getByLabelText('Play or pause audio Moment')).toHaveAttribute('src', 'blob:audio'));
    expect(screen.getByText('Voice note')).toBeInTheDocument();
  });

  it('renders original video Moment controls and poster', async () => {
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/moments/moment-video') {
        return Promise.resolve({
          data: {
            moment: {
              _id: 'moment-video',
              author: { _id: 'author-1', name: 'Deva' },
              type: 'video',
              caption: 'Video caption',
              createdAt: new Date().toISOString(),
            },
          },
        });
      }
      if (url.endsWith('/video/fallback')) return Promise.resolve({ data: new Blob(['video'], { type: 'video/mp4' }) });
      if (url.endsWith('/video/poster')) return Promise.resolve({ data: new Blob(['poster'], { type: 'image/jpeg' }) });
      return Promise.reject(new Error('unexpected url'));
    });

    renderModal('moment-video');

    const video = await screen.findByLabelText('Play or pause video Moment');
    expect(video).toHaveAttribute('src', 'blob:video/mp4');
    expect(video).toHaveAttribute('poster', 'blob:image/jpeg');
    expect(screen.getByText('Video caption')).toBeInTheDocument();
    expect(createMomentVideoPlaybackSession).toHaveBeenCalledWith('moment-video');
  });

  it('renders unavailable fallback when the original Moment cannot be fetched', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('not found'));

    renderModal('missing-moment');

    expect(await screen.findByText('This Moment is no longer available.')).toBeInTheDocument();
  });
});
