import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getRedisClient } from '../redis';
import { findUserById } from '../models/user';
import { logger } from '@repo/utils';

const PRESENCE_TTL = 300; // 5 minutes in seconds

export async function getPresence(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid user ID format',
      });
      return;
    }

    // Check if user exists
    const user = await findUserById(id);
    if (!user) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
      return;
    }

    // Get presence from Redis
    const redis = getRedisClient();
    const presenceKey = `presence:${id}`;
    const presenceData = await redis.get(presenceKey);

    if (presenceData) {
      // User is online (presence key exists in Redis)
      const presence = JSON.parse(presenceData);
      res.status(200).json({
        online: true,
        lastSeen: presence.lastSeen || new Date().toISOString(),
      });
    } else {
      // User is offline, return lastSeen from database
      res.status(200).json({
        online: false,
        lastSeen: user.lastSeen.toISOString(),
      });
    }
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'Error fetching presence');
    next(error);
  }
}

// Helper function to update presence (can be called from gateway/socket events)
export async function updatePresence(userId: string, online: boolean): Promise<void> {
  try {
    const redis = getRedisClient();
    const presenceKey = `presence:${userId}`;

    if (online) {
      // Set presence with TTL
      const presenceData = {
        online: true,
        lastSeen: new Date().toISOString(),
      };
      await redis.setex(presenceKey, PRESENCE_TTL, JSON.stringify(presenceData));
    } else {
      // Remove presence key
      await redis.del(presenceKey);
    }
  } catch (error) {
    logger.error({ error, userId }, 'Error updating presence');
    throw error;
  }
}
