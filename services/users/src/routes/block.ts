import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { addBlockedUser, removeBlockedUser, findUserById } from '../models/user';
import { deleteRelationshipsBetween } from '../models/profile-relationship';
import {
  hasBlockBetween,
  listCounterpartBlockIds,
  removeUserBlock,
  upsertUserBlock,
  getUserBlocksCollection,
} from '../models/user-block';
import { logger } from '@repo/utils';

const blockUserSchema = z.object({
  userId: z.string().refine((val) => ObjectId.isValid(val), {
    message: 'Invalid user ID format',
  }),
});

function getTargetUserId(req: Request) {
  return (req.params.userId || req.body?.userId) as string | undefined;
}

export async function blockUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;

    if (!currentUserId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const validation = blockUserSchema.safeParse({ userId: getTargetUserId(req) });

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid input data',
        details: validation.error.errors,
      });
      return;
    }

    const { userId } = validation.data;
    const currentObjectId = new ObjectId(currentUserId);
    const targetObjectId = new ObjectId(userId);

    // Check if trying to block self
    if (userId === currentUserId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot block yourself',
      });
      return;
    }

    // Check if user to block exists
    const userToBlock = await findUserById(userId);
    if (!userToBlock) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
      return;
    }

    // Add user to blocked list
    await upsertUserBlock(currentObjectId, targetObjectId);
    await deleteRelationshipsBetween(currentObjectId, targetObjectId);
    await addBlockedUser(currentObjectId, targetObjectId);

    res.status(200).json({
      success: true,
      message: 'User blocked successfully',
    });
  } catch (error) {
    logger.error({ error, userId: (req as any).user?.userId }, 'Error blocking user');
    next(error);
  }
}

export async function unblockUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;

    if (!currentUserId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const validation = blockUserSchema.safeParse({ userId: getTargetUserId(req) });

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid input data',
        details: validation.error.errors,
      });
      return;
    }

    const { userId } = validation.data;

    // Remove user from blocked list
    await removeUserBlock(new ObjectId(currentUserId), new ObjectId(userId));
    await removeBlockedUser(currentUserId, userId);

    res.status(200).json({
      success: true,
      message: 'User unblocked successfully',
    });
  } catch (error) {
    logger.error({ error, userId: (req as any).user?.userId }, 'Error unblocking user');
    next(error);
  }
}

export async function listBlockedUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const blockerUserId = new ObjectId(currentUserId);
    const blocks = await getUserBlocksCollection()
      .aggregate([
        { $match: { blockerUserId } },
        {
          $lookup: {
            from: 'users',
            localField: 'blockedUserId',
            foreignField: '_id',
            as: 'blockedUser',
          },
        },
        { $unwind: { path: '$blockedUser', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            userId: '$blockedUserId',
            blockedAt: '$createdAt',
            user: {
              _id: '$blockedUser._id',
              name: '$blockedUser.name',
              username: '$blockedUser.username',
              avatarUrl: '$blockedUser.avatarUrl',
            },
          },
        },
        { $sort: { blockedAt: -1 } },
      ])
      .toArray();

    res.status(200).json({ blockedUsers: blocks });
  } catch (error) {
    next(error);
  }
}

export async function getBlockRelationship(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;
    const targetUserId = req.params.userId || req.query.userId;
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    if (typeof targetUserId !== 'string' || !ObjectId.isValid(targetUserId)) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID format' });
      return;
    }

    const blocked = await hasBlockBetween(new ObjectId(currentUserId), new ObjectId(targetUserId));
    res.status(200).json({ blocked });
  } catch (error) {
    next(error);
  }
}

export async function listBlockVisibilityExclusions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    const excludedUserIds = await listCounterpartBlockIds(new ObjectId(currentUserId));
    res.status(200).json({ userIds: excludedUserIds.map((id) => id.toString()) });
  } catch (error) {
    next(error);
  }
}
