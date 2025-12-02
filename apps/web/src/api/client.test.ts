import { describe, it, expect, beforeEach } from 'vitest';
import { setAccessToken, getAccessToken } from './client';

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
});
