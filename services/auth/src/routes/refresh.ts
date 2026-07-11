import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, UnauthorizedError } from '@repo/utils';
import { compareRefreshToken, getDeviceSessionsCollection, hashRefreshToken } from '../models/device-session';
import { getUsersCollection } from '../models/user';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getRefreshTokenTTL,
} from '../utils/jwt';
import { getRefreshCookieOptions } from '../utils/cookies';

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  // Read refresh token from cookie
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    throw new UnauthorizedError('Refresh token not found');
  }

  // Verify refresh token
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const userId = new ObjectId(payload.userId);

  // Find matching DeviceSession
  const deviceSessionsCollection = getDeviceSessionsCollection();
  const sessions = await deviceSessionsCollection
    .find({ userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } } as any)
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .toArray();

  if (sessions.length === 0) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Find the session that matches the refresh token
  let matchingSession = null;
  for (const session of sessions) {
    const isMatch = await compareRefreshToken(refreshToken, session.refreshTokenHash);
    if (isMatch) {
      matchingSession = session;
      break;
    }
  }

  if (!matchingSession) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Verify user still exists
  const usersCollection = getUsersCollection();
  const user = await usersCollection.findOne({ _id: userId });

  if (!user || user.deactivatedAt) {
    throw new UnauthorizedError('User not found');
  }

  // Generate new access and refresh tokens
  const tokenPayload = {
    userId: user._id.toString(),
    username: user.username,
    email: user.email,
  };

  const newAccessToken = generateAccessToken(tokenPayload);
  const newRefreshToken = generateRefreshToken(tokenPayload);

  // Hash new refresh token
  const newRefreshTokenHash = await hashRefreshToken(newRefreshToken);

  // Rotate credentials without creating a new device row.
  const refreshTTL = getRefreshTokenTTL();
  const now = new Date();
  const rotation = await deviceSessionsCollection.updateOne(
    {
      _id: matchingSession._id,
      refreshTokenHash: matchingSession.refreshTokenHash,
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    } as any,
    {
      $set: {
        refreshTokenHash: newRefreshTokenHash,
        userAgent: req.headers['user-agent'] || matchingSession.userAgent || 'unknown',
        ipAddress: req.ip || matchingSession.ipAddress || 'unknown',
        expiresAt: new Date(now.getTime() + refreshTTL),
        lastActiveAt: now,
      },
    }
  );

  // Only one concurrent request may consume a refresh token. Keeping the same
  // row also prevents token rotation from looking like a new physical device.
  if (rotation.matchedCount === 0) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Set new httpOnly cookie
  res.cookie('refreshToken', newRefreshToken, getRefreshCookieOptions(refreshTTL));

  // Return new access token
  res.status(200).json({
    accessToken: newAccessToken,
  });
});
