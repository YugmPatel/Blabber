import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, UnauthorizedError } from '@repo/utils';
import { compareRefreshToken, getDeviceSessionsCollection } from '../models/device-session';
import { verifyRefreshToken } from '../utils/jwt';
import { getRefreshCookieOptions } from '../utils/cookies';

export const logout = asyncHandler(async (req: Request, res: Response) => {
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
  const sessions = await deviceSessionsCollection.find({ userId, revokedAt: { $exists: false } } as any).toArray();

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

  // Delete the DeviceSession
  await deviceSessionsCollection.deleteOne({ _id: matchingSession._id });

  // Clear refresh token cookie
  res.clearCookie('refreshToken', getRefreshCookieOptions());

  // Return success response
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});
