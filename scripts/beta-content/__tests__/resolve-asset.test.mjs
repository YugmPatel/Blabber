import { describe, expect, it, vi } from 'vitest';

vi.mock('../providers/pexels.mjs', () => ({ searchPhotos: vi.fn(), searchVideos: vi.fn() }));
vi.mock('../providers/pixabay.mjs', () => ({ searchPhotos: vi.fn(), searchVideos: vi.fn() }));
vi.mock('../providers/unsplash.mjs', () => ({ searchPhotos: vi.fn() }));

const pexels = await import('../providers/pexels.mjs');
const pixabay = await import('../providers/pixabay.mjs');
const unsplash = await import('../providers/unsplash.mjs');
const { resolvePhoto, resolveVideo, photoProviderOrder, videoProviderOrder } = await import('../resolve-asset.mjs');

function validPhoto(provider) {
  return { provider, kind: 'photo', sourceAssetId: '1', width: 2000, height: 1400, downloadUrl: 'https://example.com/1.jpg' };
}

function validVideo(provider) {
  return { provider, kind: 'video', sourceAssetId: '1', width: 720, height: 1280, durationSeconds: 10, downloadUrl: 'https://example.com/1.mp4' };
}

describe('videoProviderOrder', () => {
  it('never includes Unsplash (it has no video API)', () => {
    expect(videoProviderOrder()).toEqual(['pexels', 'pixabay']);
  });
});

describe('photoProviderOrder', () => {
  it('always includes exactly pexels, pixabay, and unsplash, in some order', () => {
    for (const seedKey of ['beta-post-blabber-001', 'beta-post-foodfinds-004', 'x']) {
      expect(new Set(photoProviderOrder(seedKey))).toEqual(new Set(['pexels', 'pixabay', 'unsplash']));
    }
  });

  it('is deterministic for the same seedKey', () => {
    expect(photoProviderOrder('beta-post-blabber-001')).toEqual(photoProviderOrder('beta-post-blabber-001'));
  });
});

describe('resolvePhoto', () => {
  it('returns the first provider in order that has a valid candidate', async () => {
    pexels.searchPhotos.mockResolvedValue([validPhoto('pexels')]);
    pixabay.searchPhotos.mockResolvedValue([validPhoto('pixabay')]);
    unsplash.searchPhotos.mockResolvedValue([validPhoto('unsplash')]);

    const { picked } = await resolvePhoto({ seedKey: 'beta-post-blabber-001', query: 'test', apiKeys: { pexels: 'k', pixabay: 'k', unsplash: 'k' } });
    expect(picked).not.toBeNull();
    expect(['pexels', 'pixabay', 'unsplash']).toContain(picked.provider);
  });

  it('falls through to the next provider when the first returns nothing usable', async () => {
    pexels.searchPhotos.mockResolvedValue([]);
    pixabay.searchPhotos.mockResolvedValue([]);
    unsplash.searchPhotos.mockResolvedValue([validPhoto('unsplash')]);

    const { picked, attempts } = await resolvePhoto({ seedKey: 'x', query: 'test', apiKeys: { pexels: 'k', pixabay: 'k', unsplash: 'k' } });
    expect(picked.provider).toBe('unsplash');
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null (caller must use local fallback) when every provider comes back empty', async () => {
    pexels.searchPhotos.mockResolvedValue([]);
    pixabay.searchPhotos.mockResolvedValue([]);
    unsplash.searchPhotos.mockResolvedValue([]);

    const { picked } = await resolvePhoto({ seedKey: 'x', query: 'test', apiKeys: { pexels: 'k', pixabay: 'k', unsplash: 'k' } });
    expect(picked).toBeNull();
  });

  it('skips a provider with no configured API key instead of erroring', async () => {
    pexels.searchPhotos.mockResolvedValue([validPhoto('pexels')]);

    // photoProviderOrder('x') resolves to ['unsplash', 'pexels', 'pixabay'] —
    // with only a Pexels key configured, unsplash must be skipped first
    // before falling through to the pexels pick that succeeds.
    const { picked, attempts } = await resolvePhoto({ seedKey: 'x', query: 'test', apiKeys: { pexels: 'k' } });
    const skipped = attempts.filter((attempt) => attempt.skipped);
    expect(skipped.length).toBeGreaterThan(0);
    expect(picked).not.toBeNull();
  });

  it('continues to the next provider (does not throw) when one provider errors', async () => {
    pexels.searchPhotos.mockRejectedValue(new Error('pexels_down'));
    pixabay.searchPhotos.mockResolvedValue([validPhoto('pixabay')]);
    unsplash.searchPhotos.mockResolvedValue([]);

    const { picked, attempts } = await resolvePhoto({ seedKey: 'x', query: 'test', apiKeys: { pexels: 'k', pixabay: 'k', unsplash: 'k' } });
    expect(attempts.some((attempt) => attempt.error)).toBe(true);
    expect(picked).not.toBeNull();
  });
});

describe('resolveVideo', () => {
  it('tries Pexels then Pixabay only', async () => {
    pexels.searchVideos.mockResolvedValue([]);
    pixabay.searchVideos.mockResolvedValue([validVideo('pixabay')]);

    const { picked, attempts } = await resolveVideo({ seedKey: 'beta-reel-campusdaily-001', query: 'test', apiKeys: { pexels: 'k', pixabay: 'k' } });
    expect(picked.provider).toBe('pixabay');
    expect(attempts.map((attempt) => attempt.provider)).toEqual(['pexels', 'pixabay']);
  });

  it('returns null when neither video provider has anything usable', async () => {
    pexels.searchVideos.mockResolvedValue([]);
    pixabay.searchVideos.mockResolvedValue([]);

    const { picked } = await resolveVideo({ seedKey: 'x', query: 'test', apiKeys: { pexels: 'k', pixabay: 'k' } });
    expect(picked).toBeNull();
  });
});
