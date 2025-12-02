import Redis from 'ioredis';
import { loadRedisConfig } from '@repo/config';
import { logger } from '@repo/utils';

let redisClient: Redis | null = null;

export function connectToRedis(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const config = loadRedisConfig();

  redisClient = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redisClient.on('connect', () => {
    logger.info('Connected to Redis');
  });

  redisClient.on('error', (error) => {
    logger.error({ error }, 'Redis connection error');
  });

  return redisClient;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call connectToRedis() first.');
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Closed Redis connection');
  }
}
