import { describe, expect, it, vi } from 'vitest';
import { parsePhotosResponse, parseVideosResponse, pickBestVideoFile, searchPhotos, searchVideos } from '../../providers/pixabay.mjs';

const PHOTOS_FIXTURE = {
  hits: [
    {
      id: 333,
      imageWidth: 3000,
      imageHeight: 2000,
      pageURL: 'https://pixabay.com/photos/333/',
      largeImageURL: 'https://pixabay.com/get/333-large.jpg',
      webformatURL: 'https://pixabay.com/get/333-web.jpg',
      user: 'pixabay_user',
      tags: 'coffee, cafe, drink',
    },
  ],
};

const VIDEOS_FIXTURE = {
  hits: [
    {
      id: 444,
      duration: 8,
      pageURL: 'https://pixabay.com/videos/444/',
      user: 'pixabay_video_user',
      tags: 'city, walk',
      videos: {
        large: { url: 'https://pixabay.com/get/444-large.mp4', width: 1920, height: 1080, size: 9000000 },
        medium: { url: 'https://pixabay.com/get/444-medium.mp4', width: 1280, height: 720, size: 4000000 },
        small: { url: 'https://pixabay.com/get/444-small.mp4', width: 640, height: 360, size: 1000000 },
        tiny: { url: 'https://pixabay.com/get/444-tiny.mp4', width: 320, height: 180, size: 400000 },
      },
    },
  ],
};

describe('parsePhotosResponse', () => {
  it('normalizes a Pixabay image search response into candidate shape', () => {
    const result = parsePhotosResponse(PHOTOS_FIXTURE);
    expect(result).toEqual([
      {
        provider: 'pixabay',
        kind: 'photo',
        sourceAssetId: '333',
        width: 3000,
        height: 2000,
        downloadUrl: 'https://pixabay.com/get/333-large.jpg',
        previewUrl: 'https://pixabay.com/get/333-web.jpg',
        photographer: 'pixabay_user',
        providerPageUrl: 'https://pixabay.com/photos/333/',
        tags: 'coffee, cafe, drink',
      },
    ]);
  });

  it('handles a response with no hits array gracefully', () => {
    expect(parsePhotosResponse({})).toEqual([]);
  });
});

describe('pickBestVideoFile', () => {
  it('prefers the medium quality tier', () => {
    expect(pickBestVideoFile(VIDEOS_FIXTURE.hits[0].videos).url).toBe('https://pixabay.com/get/444-medium.mp4');
  });

  it('falls back through large -> small -> tiny when medium is absent', () => {
    expect(pickBestVideoFile({ large: { url: 'L' } }).url).toBe('L');
    expect(pickBestVideoFile({ small: { url: 'S' } }).url).toBe('S');
    expect(pickBestVideoFile({ tiny: { url: 'T' } }).url).toBe('T');
  });

  it('returns null for a missing/malformed videos object', () => {
    expect(pickBestVideoFile(null)).toBeNull();
    expect(pickBestVideoFile({})).toBeNull();
  });
});

describe('parseVideosResponse', () => {
  it('normalizes a Pixabay video search response, selecting the medium tier', () => {
    const result = parseVideosResponse(VIDEOS_FIXTURE);
    expect(result[0]).toMatchObject({
      provider: 'pixabay',
      kind: 'video',
      sourceAssetId: '444',
      width: 1280,
      height: 720,
      durationSeconds: 8,
      downloadUrl: 'https://pixabay.com/get/444-medium.mp4',
    });
  });
});

describe('searchPhotos / searchVideos (fetch wrapper)', () => {
  it('passes the API key as a query param (not a header) and a min_width floor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => PHOTOS_FIXTURE });
    await searchPhotos({ query: 'campus', apiKey: 'pixabay-key', fetchImpl });
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('key=pixabay-key');
    expect(String(url)).toContain('min_width=1080');
    expect(String(url)).toContain('image_type=photo');
  });

  it('throws a specific error on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(searchPhotos({ query: 'x', apiKey: 'k', fetchImpl })).rejects.toThrow('pixabay___http_429');
  });

  it('calls the videos endpoint for searchVideos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => VIDEOS_FIXTURE });
    const results = await searchVideos({ query: 'city', apiKey: 'k', fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/videos/');
    expect(results).toHaveLength(1);
  });
});
