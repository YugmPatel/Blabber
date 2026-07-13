import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { ObjectId } from 'mongodb';
import { RegisterDTOSchema } from '@repo/types';
import { asyncHandler, ValidationError } from '@repo/utils';
import { getUsersCollection } from '../models/user';
import { getDeviceSessionsCollection, hashRefreshToken } from '../models/device-session';
import { generateAccessToken, generateRefreshToken, getRefreshTokenTTL } from '../utils/jwt';
import { getRefreshCookieOptions } from '../utils/cookies';
import { getEmailVerificationTokensCollection, hashToken, randomToken } from '../models/account-security';
import { sendVerifyEmail } from '../utils/account-email';
import { isReservedUsername } from '../reserved-usernames';

export const register = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validation = RegisterDTOSchema.safeParse(req.body);

  if (!validation.success) {
    throw new ValidationError('Invalid registration data');
  }

  const { username, email, password, name } = validation.data;

  if (isReservedUsername(username)) {
    throw new ValidationError('This username is reserved. Please choose another.');
  }

  const usersCollection = getUsersCollection();

  // Check if username already exists
  const existingUsername = await usersCollection.findOne({ username });
  if (existingUsername) {
    throw new ValidationError('Username already exists');
  }

  // Check if email already exists
  const existingEmail = await usersCollection.findOne({ email });
  if (existingEmail) {
    throw new ValidationError('Email already exists');
  }

  // Hash password with bcrypt (10 rounds)
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user document
  const now = new Date();
  const userDoc = {
    _id: new ObjectId(),
    username,
    email,
    passwordHash,
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

  // Generate JWT tokens
  const tokenPayload = {
    userId: userDoc._id.toString(),
    username: userDoc.username,
    email: userDoc.email,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Hash refresh token for storage
  const refreshTokenHash = await hashRefreshToken(refreshToken);

  // Create DeviceSession
  const deviceSessionsCollection = getDeviceSessionsCollection();
  const refreshTTL = getRefreshTokenTTL();
  const expiresAt = new Date(Date.now() + refreshTTL);

  await deviceSessionsCollection.insertOne({
    _id: new ObjectId(),
    userId: userDoc._id,
    refreshTokenHash,
    userAgent: req.headers['user-agent'] || 'unknown',
    ipAddress: req.ip || 'unknown',
    expiresAt,
    createdAt: now,
    lastActiveAt: now,
  });

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

  // Set httpOnly cookie for refresh token
  res.cookie('refreshToken', refreshToken, getRefreshCookieOptions(refreshTTL));

  // Return user data and access token
  res.status(201).json({
    user: {
      _id: userDoc._id.toString(),
      username: userDoc.username,
      email: userDoc.email,
      name: userDoc.name,
      avatarSource: userDoc.avatarSource,
      authProvider: userDoc.authProvider,
      emailVerified: userDoc.emailVerified,
    },
    accessToken,
  });
});
