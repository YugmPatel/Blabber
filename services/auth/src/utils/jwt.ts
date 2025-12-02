import jwt, { SignOptions } from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { loadJWTConfig } from '@repo/config';
import { JWTPayload } from '@repo/types';

const jwtConfig = loadJWTConfig();

export function generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const options: SignOptions = {
    expiresIn: jwtConfig.JWT_ACCESS_TTL as any,
    jwtid: randomBytes(16).toString('hex'), // Add unique JWT ID
  };
  return jwt.sign(payload, jwtConfig.JWT_ACCESS_SECRET, options);
}

export function generateRefreshToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const options: SignOptions = {
    expiresIn: jwtConfig.JWT_REFRESH_TTL as any,
    jwtid: randomBytes(16).toString('hex'), // Add unique JWT ID
  };
  return jwt.sign(payload, jwtConfig.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, jwtConfig.JWT_ACCESS_SECRET) as JWTPayload;
}

export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, jwtConfig.JWT_REFRESH_SECRET) as JWTPayload;
}

export function getRefreshTokenTTL(): number {
  const ttl = jwtConfig.JWT_REFRESH_TTL;
  // Parse TTL string (e.g., "30d", "7d", "24h")
  const match = ttl.match(/^(\d+)([dhms])$/);
  if (!match) {
    throw new Error('Invalid JWT_REFRESH_TTL format');
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60 * 1000; // days to milliseconds
    case 'h':
      return value * 60 * 60 * 1000; // hours to milliseconds
    case 'm':
      return value * 60 * 1000; // minutes to milliseconds
    case 's':
      return value * 1000; // seconds to milliseconds
    default:
      throw new Error('Invalid JWT_REFRESH_TTL unit');
  }
}
