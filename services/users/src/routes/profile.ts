import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { findUserById } from '../models/user';
import { logger } from '@repo/utils';

export async function getUserProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid user ID format',
      });
      return;
    }

    const user = await findUserById(id);

    if (!user) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
      return;
    }

    // Return user details without sensitive information
    res.status(200).json({
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        about: user.about,
        lastSeen: user.lastSeen,
      },
    });
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'Error fetching user profile');
    next(error);
  }
}
