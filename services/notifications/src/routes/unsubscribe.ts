import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@repo/utils';
import { deletePushSubscriptionByEndpoint } from '../models/push-subscription';

// Zod schema for unsubscribe
const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function unsubscribe(req: Request, res: Response) {
  try {
    // Validate request body
    const validation = unsubscribeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const { endpoint } = validation.data;

    // Delete push subscription
    const deleted = await deletePushSubscriptionByEndpoint(endpoint);

    if (!deleted) {
      logger.warn({ endpoint }, 'Push subscription not found');

      return res.status(404).json({
        error: 'Not Found',
        message: 'Push subscription not found',
      });
    }

    logger.info({ endpoint }, 'Push subscription deleted');

    return res.status(200).json({
      success: true,
      message: 'Push subscription deleted',
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to delete push subscription');

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete push subscription',
    });
  }
}
