import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, UnauthorizedError, NotFoundError } from '@repo/utils';
import { getUsersCollection } from '../models/user';

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  // User should be attached by auth middleware
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  const usersCollection = getUsersCollection();

  // Fetch user from database
  const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Return user details
  res.status(200).json({
    user: {
      _id: user._id.toString(),
      username: user.username,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      about: user.about,
      lastSeen: user.lastSeen,
      createdAt: user.createdAt,
    },
  });
});
