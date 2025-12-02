import { Request, Response } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { createPushSubscription } from '../models/push-subscription';

// Zod schema for push subscription
const subscribeSchema = z.object({
  userId: z.string().refine((val) => ObjectId.isValid(val), {
    message: 'Invalid userId format',
  }),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string(),
    }),
  }),
});

export async function subscribe(req: Request, res: Response) {
  try {
    // Validate request body
    const validation = subscribeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const { userId, subscription } = validation.data;

    try {
      // Create push subscription
      const pushSubscription = await createPushSubscription({
        userId: new ObjectId(userId),
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userAgent: req.headers['user-agent'],
      });

      logger.info(
        {
          userId,
          endpoint: subscription.endpoint,
        },
        'Push subscription created'
      );

      return res.status(201).json({
        success: true,
        subscriptionId: pushSubscription._id,
      });
    } catch (error: any) {
      // Handle duplicate endpoint error
      if (error.code === 11000) {
        logger.warn(
          {
            endpoint: subscription.endpoint,
          },
          'Duplicate push subscription endpoint'
        );

        return res.status(200).json({
          success: true,
          message: 'Subscription already exists',
        });
      }
      throw error;
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to create push subscription');

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create push subscription',
    });
  }
}
