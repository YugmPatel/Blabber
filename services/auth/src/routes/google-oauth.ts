import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger } from '@repo/utils';
import { getUsersCollection, UserDocument } from '../models/user';
import { getDeviceSessionsCollection } from '../models/device-session';
import { generateAccessToken, generateRefreshToken, getRefreshTokenTTL } from '../utils/jwt';
import { getRefreshCookieOptions } from '../utils/cookies';

const STATE_COOKIE = 'googleOAuthState';
const VERIFIER_COOKIE = 'googleOAuthVerifier';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

function appBaseUrl() {
  return process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
}

function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

function redirectWithError(res: Response, code: string) {
  res.redirect(`${appBaseUrl()}/login?oauth=${encodeURIComponent(code)}`);
}

function base64Url(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function oauthCookieOptions() {
  return {
    ...getRefreshCookieOptions(10 * 60 * 1000),
    path: '/api/auth/google',
  };
}

function clearOAuthCookies(res: Response) {
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
  res.clearCookie(VERIFIER_COOKIE, { path: '/api/auth/google' });
}

async function createSession(req: Request, res: Response, user: UserDocument) {
  const tokenPayload = {
    userId: user._id.toString(),
    username: user.username,
    email: user.email,
  };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const refreshTTL = getRefreshTokenTTL();
  const now = new Date();

  await getDeviceSessionsCollection().insertOne({
    _id: new ObjectId(),
    userId: user._id,
    refreshTokenHash,
    userAgent: req.headers['user-agent'] || 'unknown',
    ipAddress: req.ip || 'unknown',
    expiresAt: new Date(Date.now() + refreshTTL),
    createdAt: now,
  });

  res.cookie('refreshToken', refreshToken, getRefreshCookieOptions(refreshTTL));
  return accessToken;
}

async function uniqueUsernameFromEmail(email: string) {
  const collection = getUsersCollection();
  const rawBase = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user';
  const base = rawBase.slice(0, 24) || 'user';
  let candidate = base;
  let suffix = 0;

  while (await collection.findOne({ username: candidate })) {
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 30);
  }

  return candidate;
}

function googleAvatarUpdateFor(user: UserDocument | null, googlePicture?: string) {
  const update: Record<string, unknown> = {};
  if (!googlePicture) return update;

  update.googleAvatarUrl = googlePicture;

  const source = user?.avatarSource ?? (user?.googleId && user.avatarUrl ? 'google' : user?.avatarUrl ? 'upload' : 'none');
  if (!user || source === 'google' || source === 'none') {
    update.avatarUrl = googlePicture;
    update.avatarSource = 'google';
  }

  return update;
}

export const googleStart = asyncHandler(async (_req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    redirectWithError(res, 'google_config_missing');
    return;
  }

  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());

  res.cookie(STATE_COOKIE, state, oauthCookieOptions());
  res.cookie(VERIFIER_COOKIE, verifier, oauthCookieOptions());

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

export const googleCallback = asyncHandler(async (req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    redirectWithError(res, 'google_config_missing');
    return;
  }

  const { code, state, error } = req.query;
  if (error) {
    clearOAuthCookies(res);
    redirectWithError(res, 'google_cancelled');
    return;
  }

  if (!code || typeof code !== 'string' || state !== req.cookies[STATE_COOKIE]) {
    clearOAuthCookies(res);
    redirectWithError(res, 'google_invalid_state');
    return;
  }

  const verifier = req.cookies[VERIFIER_COOKIE];
  if (!verifier) {
    clearOAuthCookies(res);
    redirectWithError(res, 'google_invalid_state');
    return;
  }

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed with ${tokenResponse.status}`);
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      throw new Error('Google token response did not include an access token');
    }

    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error(`Google userinfo failed with ${userInfoResponse.status}`);
    }

    const googleUser = (await userInfoResponse.json()) as GoogleUserInfo;
    if (!googleUser.sub || !googleUser.email || !googleUser.email_verified) {
      clearOAuthCookies(res);
      redirectWithError(res, 'google_unverified_email');
      return;
    }

    const users = getUsersCollection();
    const now = new Date();
    let user = await users.findOne({ googleId: googleUser.sub });

    if (!user) {
      const existingByEmail = await users.findOne({ email: googleUser.email.toLowerCase() });
      if (existingByEmail) {
        const avatarUpdate = googleAvatarUpdateFor(existingByEmail, googleUser.picture);
        await users.updateOne(
          { _id: existingByEmail._id },
          {
            $set: {
              googleId: googleUser.sub,
              emailVerified: true,
              authProvider: existingByEmail.authProvider === 'google' ? 'google' : 'both',
              ...avatarUpdate,
              updatedAt: now,
            },
          }
        );
        user = {
          ...existingByEmail,
          googleId: googleUser.sub,
          emailVerified: true,
          authProvider: 'both',
          ...avatarUpdate,
          updatedAt: now,
        };
      } else {
        const username = await uniqueUsernameFromEmail(googleUser.email);
        const passwordHash = await bcrypt.hash(base64Url(randomBytes(32)), 10);
        const avatarUpdate = googleAvatarUpdateFor(null, googleUser.picture);
        const userDoc: UserDocument = {
          _id: new ObjectId(),
          username,
          email: googleUser.email.toLowerCase(),
          passwordHash,
          name: googleUser.name || username,
          ...(avatarUpdate as Pick<UserDocument, 'avatarUrl' | 'avatarSource' | 'googleAvatarUrl'>),
          avatarSource: googleUser.picture ? 'google' : 'none',
          googleId: googleUser.sub,
          authProvider: 'google',
          emailVerified: true,
          contacts: [],
          blocked: [],
          lastSeen: now,
          createdAt: now,
          updatedAt: now,
        };
        await users.insertOne(userDoc);
        user = userDoc;
      }
    } else {
      const avatarUpdate = googleAvatarUpdateFor(user, googleUser.picture);
      if (Object.keys(avatarUpdate).length > 0) {
        await users.updateOne(
          { _id: user._id },
          {
            $set: {
              ...avatarUpdate,
              updatedAt: now,
            },
          }
        );
        user = { ...user, ...avatarUpdate, updatedAt: now };
      }
    }

    await createSession(req, res, user);
    clearOAuthCookies(res);
    res.redirect(`${appBaseUrl()}/chats`);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Google OAuth callback failed');
    clearOAuthCookies(res);
    redirectWithError(res, 'google_failed');
  }
});
