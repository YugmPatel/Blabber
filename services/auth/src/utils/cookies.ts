import type { CookieOptions } from 'express';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function parseSameSite(value: string | undefined): CookieOptions['sameSite'] {
  if (value === 'strict' || value === 'none' || value === 'lax') return value;
  return 'lax';
}

export function getRefreshCookieOptions(maxAge?: number): CookieOptions {
  const secure = parseBoolean(process.env.AUTH_COOKIE_SECURE, process.env.NODE_ENV === 'production');

  return {
    httpOnly: true,
    secure,
    sameSite: parseSameSite(process.env.AUTH_COOKIE_SAME_SITE),
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  };
}
