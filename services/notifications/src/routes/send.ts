import { Request, Response } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import webpush from 'web-push';
import { logger } from '@repo/utils';
import { loadVAPIDConfig } from '@repo/config';
import {
  findPushSubscriptionsByUserId,
  deletePushSubscriptionById,
} from '../models/push-subscription';
import { getNotificationPreferences } from '../models/notification-preferences';

// Zod schema for send notification
const sendNotificationSchema = z.object({
  userId: z.string().refine((val) => ObjectId.isValid(val), {
    message: 'Invalid userId format',
  }),
  kind: z.enum(['message', 'call']).default('message'),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.any()).optional(),
});

// Initialize web-push with VAPID keys
let vapidConfigured = false;

function configureVAPID() {
  if (vapidConfigured) return;

  try {
    const vapidConfig = loadVAPIDConfig();
    webpush.setVapidDetails(
      vapidConfig.VAPID_SUBJECT,
      vapidConfig.VAPID_PUBLIC_KEY,
      vapidConfig.VAPID_PRIVATE_KEY
    );
    vapidConfigured = true;
    logger.info('VAPID configured for web push');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to configure VAPID');
    throw error;
  }
}

export async function send(req: Request, res: Response) {
  try {
    // Validate request body
    const validation = sendNotificationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const { userId, kind, title, body, data } = validation.data;
    const userObjectId = new ObjectId(userId);

    const preferences = await getNotificationPreferences(userObjectId);
    const enabled =
      kind === 'call'
        ? preferences.callNotificationsEnabled
        : preferences.messageNotificationsEnabled;

    if (!enabled) {
      logger.info({ userId, kind }, 'Push notification skipped by user preference');
      return res.status(200).json({
        success: true,
        message: 'Notifications disabled by user preference',
        sent: 0,
      });
    }

    // Configure VAPID if not already done
    configureVAPID();

    // Find all push subscriptions for the user
    const subscriptions = await findPushSubscriptionsByUserId(userObjectId);
    const uniqueSubscriptions = Array.from(
      new Map(subscriptions.map((subscription) => [subscription.endpoint, subscription])).values()
    );

    if (uniqueSubscriptions.length === 0) {
      logger.info({ userId }, 'No push subscriptions found for user');
      return res.status(200).json({
        success: true,
        message: 'No subscriptions found',
        sent: 0,
      });
    }

    // Prepare notification payload
    const notificationBody =
      kind === 'message' && !preferences.notificationPreviewsEnabled && typeof data?.noPreviewBody === 'string'
        ? data.noPreviewBody
        : body;

    const payload = JSON.stringify({
      title,
      body: notificationBody,
      data: data || {},
    });

    // Send notifications to all subscriptions with retry logic
    const results = await Promise.allSettled(
      uniqueSubscriptions.map(async (subscription) => {
        const pushSubscription = {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
          logger.info(
            {
              userId,
              endpoint: subscription.endpoint,
            },
            'Push notification sent successfully'
          );
          return { success: true, subscriptionId: subscription._id };
        } catch (error: any) {
          logger.error(
            {
              userId,
              endpoint: subscription.endpoint,
              error: error.message,
              statusCode: error.statusCode,
            },
            'Failed to send push notification'
          );

          // Clean up expired/invalid subscriptions.
          if (error.statusCode === 404 || error.statusCode === 410) {
            logger.info(
              {
                subscriptionId: subscription._id,
                endpoint: subscription.endpoint,
              },
              'Cleaning up expired push subscription'
            );
            await deletePushSubscriptionById(subscription._id!);
          }

          throw error;
        }
      })
    );

    // Count successful sends
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failureCount = results.filter((r) => r.status === 'rejected').length;

    logger.info(
      {
        userId,
        total: uniqueSubscriptions.length,
        success: successCount,
        failed: failureCount,
      },
      'Push notification batch completed'
    );

    return res.status(200).json({
      success: true,
      sent: successCount,
      failed: failureCount,
      total: uniqueSubscriptions.length,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to send push notifications');

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to send push notifications',
    });
  }
}
