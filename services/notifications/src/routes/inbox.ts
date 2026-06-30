import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { logger } from '@repo/utils';
import { getNotificationInboxCollection, serializeNotificationInboxItem } from '../models/inbox';

const notificationIdSchema = z.object({
  notificationId: z.string().refine((value) => ObjectId.isValid(value), {
    message: 'Invalid notification ID',
  }),
});

export async function listInbox(req: Request, res: Response) {
  try {
    const authUserId = (req as any).user?.userId;
    if (!authUserId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });

    const userId = new ObjectId(authUserId);
    const items = await getNotificationInboxCollection()
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return res.status(200).json({ notifications: items.map(serializeNotificationInboxItem) });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to list notifications');
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list notifications' });
  }
}

export async function markInboxItemRead(req: Request, res: Response) {
  try {
    const authUserId = (req as any).user?.userId;
    if (!authUserId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });

    const params = notificationIdSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: 'Validation Error', message: 'Invalid notification ID', details: params.error.errors });
    }

    const result = await getNotificationInboxCollection().findOneAndUpdate(
      { _id: new ObjectId(params.data.notificationId), userId: new ObjectId(authUserId) },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not Found', message: 'Notification not found' });

    return res.status(200).json({ notification: serializeNotificationInboxItem(result) });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to mark notification read');
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to mark notification read' });
  }
}
