import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getStatusesCollection, StatusDocument } from '../models/status';
import { logger } from '@repo/utils';

const CreateStatusSchema = z.object({
  type: z.enum(['text', 'image']).default('text'),
  content: z.string().trim().min(1).max(500),
  backgroundColor: z.string().trim().max(32).optional(),
  mediaUrl: z.string().trim().url().optional(),
});

function serializeStatus(status: StatusDocument & { user?: { name?: string; username?: string; avatarUrl?: string } }) {
  return {
    _id: status._id.toString(),
    userId: status.userId.toString(),
    userName: status.user?.name || status.user?.username || 'User',
    userAvatar: status.user?.avatarUrl,
    type: status.type,
    content: status.content,
    backgroundColor: status.backgroundColor,
    mediaUrl: status.mediaUrl,
    createdAt: status.createdAt,
    expiresAt: status.expiresAt,
  };
}

export async function listStatuses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const statuses = await getStatusesCollection()
      .aggregate<StatusDocument & { user?: { name?: string; username?: string; avatarUrl?: string } }>([
        { $match: { expiresAt: { $gt: new Date() } } },
        { $sort: { createdAt: -1 } },
        { $limit: 100 },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
            pipeline: [{ $project: { name: 1, username: 1, avatarUrl: 1 } }],
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      ])
      .toArray();

    res.status(200).json({ statuses: statuses.map(serializeStatus) });
  } catch (error) {
    logger.error({ error }, 'Failed to list statuses');
    next(error);
  }
}

export async function createStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const body = CreateStatusSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid status data',
        details: body.error.errors,
      });
      return;
    }

    const now = new Date();
    const status: StatusDocument = {
      _id: new ObjectId(),
      userId: new ObjectId(userId),
      type: body.data.type,
      content: body.data.content,
      backgroundColor: body.data.backgroundColor,
      mediaUrl: body.data.mediaUrl,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    };

    await getStatusesCollection().insertOne(status);
    res.status(201).json({ status: serializeStatus(status) });
  } catch (error) {
    logger.error({ error }, 'Failed to create status');
    next(error);
  }
}

export async function deleteStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid status ID' });
      return;
    }

    const result = await getStatusesCollection().deleteOne({
      _id: new ObjectId(id),
      userId: new ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Status not found' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error({ error, statusId: req.params.id }, 'Failed to delete status');
    next(error);
  }
}
