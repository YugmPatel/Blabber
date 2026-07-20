import { describe, it, expect, beforeEach } from 'vitest';
import { setAccessToken, getAccessToken, normalizeMediaUrl } from './client';

describe('API Client', () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  describe('Token Management', () => {
    it('should store and retrieve access token', () => {
      const token = 'test-token-123';
      setAccessToken(token);
      expect(getAccessToken()).toBe(token);
    });

    it('should handle null token', () => {
      setAccessToken('some-token');
      setAccessToken(null);
      expect(getAccessToken()).toBeNull();
    });

    it('should update token when set multiple times', () => {
      setAccessToken('token-1');
      expect(getAccessToken()).toBe('token-1');

      setAccessToken('token-2');
      expect(getAccessToken()).toBe('token-2');
    });
  });

  describe('Media URL normalization', () => {
    it('returns correct absolute URLs for API and local media paths', () => {
      expect(normalizeMediaUrl('/api/reels/playback/token/fallback')).toBe('http://localhost:3000/api/reels/playback/token/fallback');
      expect(normalizeMediaUrl('/local/reels/demo/fallback.mp4')).toBe('http://localhost:3000/api/media/local/reels/demo/fallback.mp4');
      expect(normalizeMediaUrl('http://localhost:3005/local/reels/demo/fallback.mp4')).toBe('http://localhost:3000/api/media/local/reels/demo/fallback.mp4');
    });

    it('preserves blob and data URLs for already-resolved media', () => {
      expect(normalizeMediaUrl('blob:poster')).toBe('blob:poster');
      expect(normalizeMediaUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    });
  });
});
