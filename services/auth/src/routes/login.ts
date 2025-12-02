import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { ObjectId } from 'mongodb';
import { LoginDTOSchema } from '@repo/types';
import { asyncHandler, ValidationError, UnauthorizedError } from '@repo/utils';
import { getUsersCollection } from '../models/user';
import { getDeviceSessionsCollection } from '../models/device-session';
import { generateAccessToken, generateRefreshToken, getRefreshTokenTTL } from '../utils/jwt';

export const login = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validation = LoginDTOSchema.safeParse(req.body);

  if (!validation.success) {
    throw new ValidationError('Invalid login data');
  }

  const { email, password } = validation.data;

  const usersCollection = getUsersCollection();

  // Find user by email
  const user = await usersCollection.findOne({ email });
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Generate JWT tokens
  const tokenPayload = {
    userId: user._id.toString(),
    username: user.username,
    email: user.email,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Hash refresh token for storage
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

  // Create DeviceSession
  const deviceSessionsCollection = getDeviceSessionsCollection();
  const refreshTTL = getRefreshTokenTTL();
  const expiresAt = new Date(Date.now() + refreshTTL);
  const now = new Date();

  await deviceSessionsCollection.insertOne({
    _id: new ObjectId(),
    userId: user._id,
    refreshTokenHash,
    userAgent: req.headers['user-agent'] || 'unknown',
    ipAddress: req.ip || 'unknown',
    expiresAt,
    createdAt: now,
  });

  // Set httpOnly cookie for refresh token with SameSite=Lax
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: refreshTTL,
  });

  // Return user data and access token
  res.status(200).json({
    user: {
      _id: user._id.toString(),
      username: user.username,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
    accessToken,
  });
});
