import { Request, Response } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import { logger } from '@repo/utils';
import { upsertPushSubscription } from '../models/push-subscription';

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

function endpointHash(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

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

    const pushSubscription = await upsertPushSubscription({
      userId: new ObjectId(userId),
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: req.headers['user-agent'],
    });

    logger.info(
      {
        userId,
        endpointHash: endpointHash(subscription.endpoint),
      },
      'Push subscription upserted'
    );

    return res.status(pushSubscription.wasCreated ? 201 : 200).json({
      success: true,
      subscriptionId: pushSubscription._id,
      message: pushSubscription.wasCreated ? 'Subscription created' : 'Subscription already exists',
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to create push subscription');

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create push subscription',
    });
  }
}
