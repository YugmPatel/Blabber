import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { addBlockedUser, removeBlockedUser, findUserById } from '../models/user';
import { logger } from '@repo/utils';

const blockUserSchema = z.object({
  userId: z.string().refine((val) => ObjectId.isValid(val), {
    message: 'Invalid user ID format',
  }),
});

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

    // Validate request body
    const validation = blockUserSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid input data',
        details: validation.error.errors,
      });
      return;
    }

    const { userId } = validation.data;

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
    await addBlockedUser(currentUserId, userId);

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

    // Validate request body
    const validation = blockUserSchema.safeParse(req.body);

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
