import { describe, expect, it, vi } from 'vitest';
import { parsePhotosResponse, parseVideosResponse, pickBestVideoFile, searchPhotos, searchVideos } from '../../providers/pexels.mjs';

const PHOTOS_FIXTURE = {
  photos: [
    {
      id: 111,
      width: 4000,
      height: 3000,
      url: 'https://www.pexels.com/photo/111/',
      photographer: 'Jane Doe',
      alt: 'A coffee shop interior',
      src: { original: 'https://images.pexels.com/111/original.jpg', large2x: 'https://images.pexels.com/111/large2x.jpg', large: 'https://images.pexels.com/111/large.jpg', medium: 'https://images.pexels.com/111/medium.jpg' },
    },
  ],
};

const VIDEOS_FIXTURE = {
  videos: [
    {
      id: 222,
      width: 1920,
      height: 1080,
      duration: 12,
      url: 'https://www.pexels.com/video/222/',
      user: { name: 'John Roe' },
      video_pictures: [{ picture: 'https://images.pexels.com/videos/222/thumb.jpg' }],
      video_files: [
        { file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/222/horizontal.mp4' },
        { file_type: 'video/mp4', width: 720, height: 1280, link: 'https://videos.pexels.com/222/portrait.mp4' },
      ],
    },
  ],
};

describe('parsePhotosResponse', () => {
  it('normalizes a Pexels photo search response into candidate shape', () => {
    const result = parsePhotosResponse(PHOTOS_FIXTURE);
    expect(result).toEqual([
      {
        provider: 'pexels',
        kind: 'photo',
        sourceAssetId: '111',
        width: 4000,
        height: 3000,
        downloadUrl: 'https://images.pexels.com/111/large2x.jpg',
        previewUrl: 'https://images.pexels.com/111/medium.jpg',
        photographer: 'Jane Doe',
        providerPageUrl: 'https://www.pexels.com/photo/111/',
        alt: 'A coffee shop interior',
      },
    ]);
  });

  it('handles a response with no photos array gracefully', () => {
    expect(parsePhotosResponse({})).toEqual([]);
    expect(parsePhotosResponse(null)).toEqual([]);
  });
});

describe('pickBestVideoFile', () => {
  it('prefers the portrait file over the horizontal one for a Reel', () => {
    const picked = pickBestVideoFile(VIDEOS_FIXTURE.videos[0].video_files);
    expect(picked.width).toBe(720);
    expect(picked.height).toBe(1280);
  });

  it('falls back to any mp4 file when nothing is portrait', () => {
    const files = [{ file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/x.mp4' }];
    expect(pickBestVideoFile(files)?.link).toBe('https://videos.pexels.com/x.mp4');
  });

  it('returns null when there are no usable files', () => {
    expect(pickBestVideoFile([])).toBeNull();
    expect(pickBestVideoFile(undefined)).toBeNull();
  });
});

describe('parseVideosResponse', () => {
  it('normalizes a Pexels video search response, selecting the portrait file', () => {
    const result = parseVideosResponse(VIDEOS_FIXTURE);
    expect(result).toEqual([
      {
        provider: 'pexels',
        kind: 'video',
        sourceAssetId: '222',
        width: 720,
        height: 1280,
        durationSeconds: 12,
        downloadUrl: 'https://videos.pexels.com/222/portrait.mp4',
        previewUrl: 'https://images.pexels.com/videos/222/thumb.jpg',
        photographer: 'John Roe',
        providerPageUrl: 'https://www.pexels.com/video/222/',
      },
    ]);
  });
});

describe('searchPhotos / searchVideos (fetch wrapper)', () => {
  it('calls the Pexels photo endpoint with the API key header and parses the result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => PHOTOS_FIXTURE });
    const results = await searchPhotos({ query: 'coffee shop', apiKey: 'test-key', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('api.pexels.com/v1/search');
    expect(String(url)).toContain('query=coffee+shop');
    expect(options.headers.Authorization).toBe('test-key');
    expect(results).toHaveLength(1);
  });

  it('throws a specific error on a non-ok photo search response, without leaking the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(searchPhotos({ query: 'x', apiKey: 'secret-key', fetchImpl })).rejects.toThrow('pexels_v1_search_http_401');
  });

  it('calls the Pexels video endpoint and parses the result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => VIDEOS_FIXTURE });
    const results = await searchVideos({ query: 'city walking', apiKey: 'test-key', fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('api.pexels.com/videos/search');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('video');
  });
});
