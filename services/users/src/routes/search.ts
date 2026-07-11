import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { searchUsersByText, getUsersCollection } from '../models/user';
import { getDatabase } from '../db';
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
    const requesterId = currentUserId ? new ObjectId(currentUserId) : null;

    if (requesterId) {
      const usersCollection = getUsersCollection();
      const currentUser = await usersCollection.findOne(
        { _id: requesterId },
        { projection: { blocked: 1, discoveryHideBlocked: 1 } }
      );

      // "Hide blocked users" (default on) removes people you blocked from search.
      if (currentUser?.blocked && (currentUser as any).discoveryHideBlocked !== false) {
        blockedUserIds = currentUser.blocked;
      }
    }

    // Search users and filter out blocked users
    const candidates = await searchUsersByText(q.trim(), blockedUserIds);

    // Enforce each candidate's "Who can find me by username" setting.
    const db = getDatabase();
    const users = [];
    for (const candidate of candidates) {
      if (requesterId && candidate._id.equals(requesterId)) {
        users.push(candidate);
        continue;
      }
      const findability = (candidate as any).usernameFindability || 'everyone';
      if (findability === 'everyone') {
        users.push(candidate);
        continue;
      }
      if (!requesterId || findability === 'no_one') continue;
      if (findability === 'followers') {
        const relationship = await db.collection('profile_relationships').findOne({
          followerUserId: requesterId,
          targetUserId: candidate._id,
          state: 'following',
        });
        if (relationship) users.push(candidate);
        continue;
      }
      if (findability === 'contacts') {
        const sharedChat = await db.collection('chats').findOne({
          type: 'direct',
          participants: { $all: [requesterId, candidate._id] },
          deletedAt: { $exists: false },
          endedAt: { $exists: false },
        });
        if (sharedChat) users.push(candidate);
      }
    }

    // Return users without sensitive information
    const sanitizedUsers = users.map((user) => ({
      _id: user._id,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl,
      about: user.about,
      role: user.role,
      department: user.department,
    }));

    res.status(200).json({ users: sanitizedUsers });
  } catch (error) {
    logger.error({ error, query: req.query.q }, 'Error searching users');
    next(error);
  }
}
