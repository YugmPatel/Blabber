import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { searchUsersByText, getUsersCollection } from '../models/user';
import { logger } from '@repo/utils';

export async function searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Query parameter "q" is required',
      });
      return;
    }

    if (q.trim().length === 0) {
      res.status(200).json({ users: [] });
      return;
    }

    // Get current user's blocked list if authenticated
    let blockedUserIds: ObjectId[] = [];
    const currentUserId = (req as any).user?.userId;

    if (currentUserId) {
      const usersCollection = getUsersCollection();
      const currentUser = await usersCollection.findOne(
        { _id: new ObjectId(currentUserId) },
        { projection: { blocked: 1 } }
      );

      if (currentUser?.blocked) {
        blockedUserIds = currentUser.blocked;
      }
    }

    // Search users and filter out blocked users
    const users = await searchUsersByText(q.trim(), blockedUserIds);

    // Return users without sensitive information
    const sanitizedUsers = users.map((user) => ({
      _id: user._id,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl,
      about: user.about,
    }));

    res.status(200).json({ users: sanitizedUsers });
  } catch (error) {
    logger.error({ error, query: req.query.q }, 'Error searching users');
    next(error);
  }
}
