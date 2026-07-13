import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { removeUserMute, upsertUserMute } from '../models/user-mute';
import { findUserById } from '../models/user';

export async function muteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    const { userId } = req.params;
    if (!ObjectId.isValid(userId)) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID format' });
      return;
    }
    if (userId === currentUserId) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot mute yourself' });
      return;
    }
    const target = await findUserById(userId);
    if (!target) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }

    await upsertUserMute(new ObjectId(currentUserId), new ObjectId(userId));
    logger.info({ event: 'user_mute.created', userId: currentUserId }, 'User muted');
    res.status(200).json({ success: true, message: 'User muted' });
  } catch (error) {
    next(error);
  }
}

export async function unmuteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    const { userId } = req.params;
    if (!ObjectId.isValid(userId)) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID format' });
      return;
    }

    await removeUserMute(new ObjectId(currentUserId), new ObjectId(userId));
    logger.info({ event: 'user_mute.removed', userId: currentUserId }, 'User unmuted');
    res.status(200).json({ success: true, message: 'User unmuted' });
  } catch (error) {
    next(error);
  }
}
