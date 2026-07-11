import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import {
  getNotificationPreferences,
  serializeNotificationPreferences,
  updateNotificationPreferences,
} from '../models/notification-preferences';
import { logger } from '@repo/utils';
import { loadVAPIDConfig } from '@repo/config';

const userIdParamsSchema = z.object({
  userId: z.string().refine((value) => ObjectId.isValid(value), {
    message: 'Invalid userId format',
  }),
});

const updatePreferencesSchema = z
  .object({
    messageNotificationsEnabled: z.boolean().optional(),
    callNotificationsEnabled: z.boolean().optional(),
    notificationPreviewsEnabled: z.boolean().optional(),
    mentionNotificationsEnabled: z.boolean().optional(),
    actionRemindersEnabled: z.boolean().optional(),
    actionReminderDueTomorrowEnabled: z.boolean().optional(),
    actionReminderDueTodayEnabled: z.boolean().optional(),
    actionReminderOverdueEnabled: z.boolean().optional(),
    actionReminderStaleEnabled: z.boolean().optional(),
    eventRemindersEnabled: z.boolean().optional(),
    eventReminderDayBeforeEnabled: z.boolean().optional(),
    eventReminderHourBeforeEnabled: z.boolean().optional(),
    momentUpdatesEnabled: z.boolean().optional(),
    momentActivityEnabled: z.boolean().optional(),
    postActivityEnabled: z.boolean().optional(),
    reelActivityEnabled: z.boolean().optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    quietHoursTimezone: z.string().max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one preference is required',
  });

export async function getPreferences(req: Request, res: Response) {
  try {
    const authUserId = (req as any).user?.userId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    }
    const params = userIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: params.error.errors,
      });
    }
    if (authUserId !== params.data.userId) {
      return res.status(403).json({ error: 'Forbidden', message: "You cannot view another user's notification settings" });
    }

    const preferences = await getNotificationPreferences(new ObjectId(params.data.userId));
    return res.status(200).json({ preferences: serializeNotificationPreferences(preferences) });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get notification preferences');
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get notification preferences',
    });
  }
}

export async function updatePreferences(req: Request, res: Response) {
  try {
    const authUserId = (req as any).user?.userId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    }
    const params = userIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: params.error.errors,
      });
    }
    if (authUserId !== params.data.userId) {
      return res.status(403).json({ error: 'Forbidden', message: "You cannot update another user's notification settings" });
    }

    const body = updatePreferencesSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid preferences',
        details: body.error.errors,
      });
    }

    const preferences = await updateNotificationPreferences(new ObjectId(params.data.userId), body.data);
    return res.status(200).json({ preferences: serializeNotificationPreferences(preferences) });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to update notification preferences');
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update notification preferences',
    });
  }
}

export function getVapidPublicKey(_req: Request, res: Response) {
  try {
    const vapidConfig = loadVAPIDConfig();
    return res.status(200).json({ publicKey: vapidConfig.VAPID_PUBLIC_KEY });
  } catch (error: any) {
    logger.warn({ error: error.message }, 'VAPID public key unavailable');
    return res.status(200).json({ publicKey: '' });
  }
}
