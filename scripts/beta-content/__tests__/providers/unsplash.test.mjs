import { describe, expect, it, vi } from 'vitest';
import { parsePhotosResponse, searchPhotos, trackDownload } from '../../providers/unsplash.mjs';

const PHOTOS_FIXTURE = {
  results: [
    {
      id: 'abc123',
      width: 5000,
      height: 3333,
      urls: { raw: 'https://images.unsplash.com/abc123?raw', full: 'https://images.unsplash.com/abc123?full', regular: 'https://images.unsplash.com/abc123?regular', small: 'https://images.unsplash.com/abc123?small' },
      user: { name: 'Alex Photographer', links: { html: 'https://unsplash.com/@alex' } },
      links: { html: 'https://unsplash.com/photos/abc123', download_location: 'https://api.unsplash.com/photos/abc123/download' },
    },
  ],
};

describe('parsePhotosResponse', () => {
  it('normalizes an Unsplash search response into candidate shape, including the download tracking URL', () => {
    const result = parsePhotosResponse(PHOTOS_FIXTURE);
    expect(result).toEqual([
      {
        provider: 'unsplash',
        kind: 'photo',
        sourceAssetId: 'abc123',
        width: 5000,
        height: 3333,
        downloadUrl: 'https://images.unsplash.com/abc123?regular',
        previewUrl: 'https://images.unsplash.com/abc123?small',
        photographer: 'Alex Photographer',
        providerPageUrl: 'https://unsplash.com/photos/abc123',
        downloadTrackingUrl: 'https://api.unsplash.com/photos/abc123/download',
      },
    ]);
  });

  it('handles a response with no results array gracefully', () => {
    expect(parsePhotosResponse({})).toEqual([]);
  });
});

describe('searchPhotos (fetch wrapper)', () => {
  it('sends the Client-ID authorization header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => PHOTOS_FIXTURE });
    await searchPhotos({ query: 'travel city', apiKey: 'unsplash-key', fetchImpl });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('api.unsplash.com/search/photos');
    expect(options.headers.Authorization).toBe('Client-ID unsplash-key');
  });

  it('throws a specific error on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(searchPhotos({ query: 'x', apiKey: 'k', fetchImpl })).rejects.toThrow('unsplash__search_photos_http_403');
  });
});

describe('trackDownload', () => {
  it('pings the download tracking URL with the Client-ID header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await trackDownload('https://api.unsplash.com/photos/abc123/download', { apiKey: 'unsplash-key', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.unsplash.com/photos/abc123/download', { headers: { Authorization: 'Client-ID unsplash-key' } });
  });

  it('does nothing when no tracking URL is given', async () => {
    const fetchImpl = vi.fn();
    await trackDownload(undefined, { apiKey: 'k', fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws even if the ping itself fails (attribution ping must not block seeding)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(trackDownload('https://x', { apiKey: 'k', fetchImpl })).resolves.toBeUndefined();
  });
});
