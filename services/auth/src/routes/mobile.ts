import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { ObjectId } from 'mongodb';
import { LoginDTOSchema, RegisterDTOSchema } from '@repo/types';
import { asyncHandler, UnauthorizedError, ValidationError } from '@repo/utils';
import { getUsersCollection, UserDocument } from '../models/user';
import { compareRefreshToken, getDeviceSessionsCollection, hashRefreshToken } from '../models/device-session';
import { generateAccessToken, generateRefreshToken, getRefreshTokenTTL, verifyRefreshToken } from '../utils/jwt';
import { getEmailVerificationTokensCollection, hashToken, randomToken } from '../models/account-security';
import { sendVerifyEmail } from '../utils/account-email';

function serializeUser(user: UserDocument) {
  return {
    _id: user._id.toString(),
    username: user.username,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    avatarSource: user.avatarSource ?? (user.googleId && user.avatarUrl ? 'google' : user.avatarUrl ? 'upload' : 'none'),
    about: user.about,
    role: user.role,
    department: user.department,
    authProvider: user.authProvider || 'password',
    emailVerified: Boolean(user.emailVerified),
  };
}

async function createMobileSession(req: Request, user: UserDocument) {
  const tokenPayload = {
    userId: user._id.toString(),
    username: user.username,
    email: user.email,
  };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  const refreshTokenHash = await hashRefreshToken(refreshToken);
  const refreshTTL = getRefreshTokenTTL();
  const now = new Date();

  await getDeviceSessionsCollection().insertOne({
    _id: new ObjectId(),
    userId: user._id,
    refreshTokenHash,
    userAgent: req.headers['user-agent'] || 'Blabber Mobile',
    ipAddress: req.ip || 'unknown',
    expiresAt: new Date(now.getTime() + refreshTTL),
    createdAt: now,
    lastActiveAt: now,
  });

  return { accessToken, refreshToken };
}

async function findSessionForRefreshToken(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const userId = new ObjectId(payload.userId);
  const sessions = await getDeviceSessionsCollection().find({ userId, revokedAt: { $exists: false } } as any).toArray();
  for (const session of sessions) {
    if (await compareRefreshToken(refreshToken, session.refreshTokenHash)) {
      return { session, payload, userId };
    }
  }
  throw new UnauthorizedError('Invalid refresh token');
}

export const mobileLogin = asyncHandler(async (req: Request, res: Response) => {
  const validation = LoginDTOSchema.safeParse(req.body);
  if (!validation.success) throw new ValidationError('Invalid login data');

  const { email, password } = validation.data;
  const user = await getUsersCollection().findOne({ email });
  if (!user || user.deactivatedAt) throw new UnauthorizedError('Invalid email or password');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  const tokens = await createMobileSession(req, user);
  res.status(200).json({ user: serializeUser(user), ...tokens });
});

export const mobileRegister = asyncHandler(async (req: Request, res: Response) => {
  const validation = RegisterDTOSchema.safeParse(req.body);
  if (!validation.success) throw new ValidationError('Invalid registration data');

  const { username, email, password, name } = validation.data;
  const usersCollection = getUsersCollection();
  if (await usersCollection.findOne({ username })) throw new ValidationError('Username already exists');
  if (await usersCollection.findOne({ email })) throw new ValidationError('Email already exists');

  const now = new Date();
  const userDoc = {
    _id: new ObjectId(),
    username,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    name,
    avatarSource: 'none' as const,
    authProvider: 'password' as const,
    emailVerified: false,
    contacts: [],
    blocked: [],
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  };

  await usersCollection.insertOne(userDoc);

  const verificationToken = randomToken();
  await getEmailVerificationTokensCollection().insertOne({
    _id: new ObjectId(),
    userId: userDoc._id,
    tokenHash: hashToken(verificationToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: now,
    sentToEmail: userDoc.email,
  });
  void sendVerifyEmail(userDoc._id, userDoc.email, verificationToken);

  const tokens = await createMobileSession(req, userDoc as UserDocument);
  res.status(201).json({ user: serializeUser(userDoc as UserDocument), ...tokens });
});

export const mobileRefresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = String(req.body?.refreshToken || '');
  if (!refreshToken) throw new UnauthorizedError('Invalid refresh token');

  const { session, payload, userId } = await findSessionForRefreshToken(refreshToken);
  const user = await getUsersCollection().findOne({ _id: userId });
  if (!user || user.deactivatedAt) {
    await getDeviceSessionsCollection().deleteOne({ _id: session._id });
    throw new UnauthorizedError('Invalid refresh token');
  }

  const tokenPayload = {
    userId: payload.userId,
    username: user.username,
    email: user.email,
  };
  const accessToken = generateAccessToken(tokenPayload);
  const nextRefreshToken = generateRefreshToken(tokenPayload);
  const nextRefreshTokenHash = await hashRefreshToken(nextRefreshToken);
  const refreshTTL = getRefreshTokenTTL();

  await getDeviceSessionsCollection().updateOne(
    { _id: session._id },
    {
      $set: {
        refreshTokenHash: nextRefreshTokenHash,
        expiresAt: new Date(Date.now() + refreshTTL),
        lastActiveAt: new Date(),
      },
    }
  );

  res.status(200).json({ user: serializeUser(user), accessToken, refreshToken: nextRefreshToken });
});

export const mobileLogout = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = String(req.body?.refreshToken || '');
  if (refreshToken) {
    try {
      const { session } = await findSessionForRefreshToken(refreshToken);
      await getDeviceSessionsCollection().deleteOne({ _id: session._id });
    } catch {
      // Logout is idempotent for clients that already cleared local state.
    }
  }
  res.status(200).json({ message: 'Logged out successfully' });
});

export const mobileSession = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) throw new UnauthorizedError('Authentication required');
  const user = await getUsersCollection().findOne({ _id: new ObjectId(req.user.userId) });
  if (!user || user.deactivatedAt) throw new UnauthorizedError('Authentication required');
  res.status(200).json({ user: serializeUser(user) });
});
