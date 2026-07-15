import { describe, expect, it } from 'vitest';
import { idHexFor, seedKeyFor } from '../seed-keys.mjs';

describe('seedKeyFor', () => {
  it('produces the exact seedKey formats given in the task spec', () => {
    expect(seedKeyFor('user', 'blabber')).toBe('beta-user-blabber');
    expect(seedKeyFor('topic', 'tech_ai')).toBe('beta-topic-tech-ai');
    expect(seedKeyFor('post', 'studyhub', 0)).toBe('beta-post-studyhub-001');
    expect(seedKeyFor('avatar', 'blabber')).toBe('beta-avatar-blabber');
    expect(seedKeyFor('card', 'blabber', 0)).toBe('beta-card-blabber-001');
    expect(seedKeyFor('reel', 'campusdaily', 2)).toBe('beta-reel-campusdaily-003');
    expect(seedKeyFor('comment', 'techbytes', 1)).toBe('beta-comment-techbytes-002');
  });

  it('zero-pads post/reel/comment indices to 3 digits', () => {
    expect(seedKeyFor('post', 'foodfinds', 9)).toBe('beta-post-foodfinds-010');
    expect(seedKeyFor('post', 'foodfinds', 99)).toBe('beta-post-foodfinds-100');
  });

  it('throws on an unknown kind', () => {
    expect(() => seedKeyFor('unknown', 'x')).toThrow();
  });
});

describe('idHexFor (idempotency foundation)', () => {
  it('is deterministic — the same seedKey always hashes to the same id', () => {
    const first = idHexFor('beta-post-studyhub-001');
    const second = idHexFor('beta-post-studyhub-001');
    expect(first).toBe(second);
  });

  it('produces a valid 24-character hex string (a legal Mongo ObjectId payload)', () => {
    const hex = idHexFor('beta-user-blabber');
    expect(hex).toMatch(/^[0-9a-f]{24}$/);
  });

  it('different seedKeys hash to different ids', () => {
    expect(idHexFor('beta-user-blabber')).not.toBe(idHexFor('beta-user-campusdaily'));
  });

  it('the same seedKey with a different subKind (e.g. media vs post) hashes differently', () => {
    const postId = idHexFor('beta-post-studyhub-001', 'post');
    const mediaId = idHexFor('beta-post-studyhub-001', 'media');
    expect(postId).not.toBe(mediaId);
  });
});
