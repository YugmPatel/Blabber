import { Request, Response } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import webpush from 'web-push';
import { logger } from '@repo/utils';
import { loadVAPIDConfig } from '@repo/config';
import {
  findPushSubscriptionsByUserId,
  deletePushSubscriptionById,
} from '../models/push-subscription';
import { getNotificationPreferences } from '../models/notification-preferences';
import { incrementPushCounter, pushOperationalStatus } from '../push-ops';

// Zod schema for send notification
const sendNotificationSchema = z.object({
  userId: z.string().refine((val) => ObjectId.isValid(val), {
    message: 'Invalid userId format',
  }),
  kind: z.enum(['message', 'mention', 'call', 'action_reminder', 'event_reminder', 'moment_update', 'moment_activity']).default('message'),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.any()).optional(),
});

// Initialize web-push with VAPID keys
let vapidConfigured = false;

function endpointHash(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

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
        : kind === 'mention'
          ? preferences.mentionNotificationsEnabled
        : kind === 'action_reminder'
          ? preferences.actionRemindersEnabled
        : kind === 'event_reminder'
          ? preferences.eventRemindersEnabled
        : kind === 'moment_update'
          ? preferences.momentUpdatesEnabled
        : kind === 'moment_activity'
          ? preferences.momentActivityEnabled
        : preferences.messageNotificationsEnabled;

    if (!enabled) {
      incrementPushCounter('skipped');
      logger.info({ userId, kind }, 'Push notification skipped by user preference');
      return res.status(200).json({
        success: true,
        message: 'Notifications disabled by user preference',
        sent: 0,
      });
    }

    // Find all push subscriptions for the user
    const subscriptions = await findPushSubscriptionsByUserId(userObjectId);
    const uniqueSubscriptions = Array.from(
      new Map(subscriptions.map((subscription) => [subscription.endpoint, subscription])).values()
    );

    if (uniqueSubscriptions.length === 0) {
      incrementPushCounter('skipped');
      logger.info({ userId }, 'No push subscriptions found for user');
      return res.status(200).json({
        success: true,
        message: 'No subscriptions found',
        sent: 0,
      });
    }

    // Configure VAPID only when there is something to deliver.
    const pushStatus = pushOperationalStatus();
    if (!pushStatus.enabled) {
      incrementPushCounter('skipped', uniqueSubscriptions.length);
      return res.status(200).json({ success: true, message: 'Push notifications disabled', sent: 0 });
    }
    if (pushStatus.mockMode) {
      incrementPushCounter('attempted', uniqueSubscriptions.length);
      incrementPushCounter('delivered', uniqueSubscriptions.length);
      return res.status(200).json({ success: true, sent: uniqueSubscriptions.length, failed: 0, total: uniqueSubscriptions.length, mode: 'mock' });
    }
    configureVAPID();

    // Prepare notification payload
    const notificationBody =
      (kind === 'message' || kind === 'mention') && !preferences.notificationPreviewsEnabled && typeof data?.noPreviewBody === 'string'
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
          incrementPushCounter('attempted');
          await webpush.sendNotification(pushSubscription, payload);
          incrementPushCounter('delivered');
          logger.info(
            {
              userId,
              endpointHash: endpointHash(subscription.endpoint),
            },
            'Push notification sent successfully'
          );
          return { success: true, subscriptionId: subscription._id };
        } catch (error: any) {
          logger.error(
            {
              userId,
              endpointHash: endpointHash(subscription.endpoint),
              error: error.message,
              statusCode: error.statusCode,
            },
            'Failed to send push notification'
          );

          // Clean up expired/invalid subscriptions.
          if (error.statusCode === 404 || error.statusCode === 410) {
            incrementPushCounter('expired');
            logger.info(
              {
                subscriptionId: subscription._id,
                endpointHash: endpointHash(subscription.endpoint),
              },
              'Cleaning up expired push subscription'
            );
            await deletePushSubscriptionById(subscription._id!);
          }

          incrementPushCounter('failed');
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
