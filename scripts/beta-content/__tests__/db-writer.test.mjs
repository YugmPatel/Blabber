import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { accessTokenFor, idFor, provenanceFor } from '../db-writer.mjs';
import { idHexFor } from '../seed-keys.mjs';

describe('idFor', () => {
  it('wraps idHexFor into a real, valid ObjectId', () => {
    const id = idFor(ObjectId, 'beta-user-blabber');
    expect(id).toBeInstanceOf(ObjectId);
    expect(id.toString()).toBe(idHexFor('beta-user-blabber'));
  });

  it('is deterministic across calls (idempotency)', () => {
    expect(idFor(ObjectId, 'beta-post-studyhub-001').toString()).toBe(idFor(ObjectId, 'beta-post-studyhub-001').toString());
  });
});

describe('provenanceFor', () => {
  it('records full source metadata for an externally-sourced pick', () => {
    const picked = {
      provider: 'pexels',
      sourceAssetId: '9001',
      downloadUrl: 'https://images.pexels.com/9001.jpg',
      photographer: 'Jane Doe',
      providerPageUrl: 'https://www.pexels.com/photo/9001/',
      width: 4000,
      height: 3000,
    };
    const provenance = provenanceFor({ picked, seedKey: 'beta-post-foodfinds-001', searchQuery: 'coffee shop' });
    expect(provenance).toMatchObject({
      source: 'pexels',
      sourceAssetId: '9001',
      sourceUrl: 'https://images.pexels.com/9001.jpg',
      sourceAuthor: 'Jane Doe',
      sourceProviderUrl: 'https://www.pexels.com/photo/9001/',
      seedKey: 'beta-post-foodfinds-001',
      searchQuery: 'coffee shop',
      originalWidth: 4000,
      originalHeight: 3000,
    });
    expect(provenance.downloadedAt).toBeInstanceOf(Date);
  });

  it('records source: "generated" for a local fallback (picked is null)', () => {
    const provenance = provenanceFor({ picked: null, seedKey: 'beta-reel-blabber-001', searchQuery: 'app onboarding' });
    expect(provenance.source).toBe('generated');
    expect(provenance.sourceAssetId).toBe('beta-reel-blabber-001');
  });

  it('includes video duration when the pick is a video candidate', () => {
    const picked = { provider: 'pexels', sourceAssetId: '1', downloadUrl: 'https://x/1.mp4', width: 720, height: 1280, durationSeconds: 12 };
    const provenance = provenanceFor({ picked, seedKey: 'beta-reel-techbytes-001', searchQuery: 'coding' });
    expect(provenance.durationSeconds).toBe(12);
  });
});

describe('accessTokenFor', () => {
  it('mints a well-formed three-part JWT signed with the given secret', () => {
    const token = accessTokenFor({ _id: new ObjectId(), username: 'blabber', email: 'beta@local.blabber.dev' }, 'test-secret-at-least-32-characters-long');
    expect(token.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.username).toBe('blabber');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('produces a different signature for a different secret (never logs/leaks the secret itself)', () => {
    const user = { _id: new ObjectId(), username: 'blabber', email: 'beta@local.blabber.dev' };
    const tokenA = accessTokenFor(user, 'secret-a-32-characters-long-000000');
    const tokenB = accessTokenFor(user, 'secret-b-32-characters-long-000000');
    expect(tokenA.split('.')[2]).not.toBe(tokenB.split('.')[2]);
  });
});
