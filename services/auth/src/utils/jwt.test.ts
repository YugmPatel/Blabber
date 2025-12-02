import { describe, it, expect } from 'vitest';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshTokenTTL,
} from './jwt';

describe('JWT Utils', () => {
  describe('generateAccessToken', () => {
    it('should generate a valid access token', () => {
      const payload = {
        userId: '123',
        username: 'testuser',
        email: 'test@example.com',
      };

      const token = generateAccessToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const payload = {
        userId: '123',
        username: 'testuser',
        email: 'test@example.com',
      };

      const token = generateRefreshToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify and decode a valid access token', () => {
      const payload = {
        userId: '123',
        username: 'testuser',
        email: 'test@example.com',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyAccessToken(token);

      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.username).toBe(payload.username);
      expect(decoded.email).toBe(payload.email);
    });

    it('should throw error for invalid token', () => {
      expect(() => verifyAccessToken('invalid-token')).toThrow();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify and decode a valid refresh token', () => {
      const payload = {
        userId: '123',
        username: 'testuser',
        email: 'test@example.com',
      };

      const token = generateRefreshToken(payload);
      const decoded = verifyRefreshToken(token);

      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.username).toBe(payload.username);
      expect(decoded.email).toBe(payload.email);
    });
  });

  describe('getRefreshTokenTTL', () => {
    it('should parse TTL correctly', () => {
      const ttl = getRefreshTokenTTL();
      expect(ttl).toBeGreaterThan(0);
      // 30 days = 30 * 24 * 60 * 60 * 1000 = 2592000000 ms
      expect(ttl).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });
});
