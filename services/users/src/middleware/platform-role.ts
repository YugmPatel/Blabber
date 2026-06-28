import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getUsersCollection } from '../models/user';

export async function requirePlatformModerator(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId || !ObjectId.isValid(userId)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const user = await getUsersCollection().findOne(
      { _id: new ObjectId(userId) },
      { projection: { platformRole: 1 } }
    );
    const role = user?.platformRole || 'user';
    if (role !== 'moderator' && role !== 'admin') {
      res.status(403).json({ error: 'Forbidden', message: 'Moderator access required' });
      return;
    }

    (req as any).platformRole = role;
    next();
  } catch (error) {
    next(error);
  }
}
