import { loadRedisConfig } from '@repo/config';
import { logger, RedisPubSub } from '@repo/utils';

let pubsub: RedisPubSub | null = null;

export function initPubSub(): RedisPubSub {
  if (pubsub) return pubsub;
  const config = loadRedisConfig();
  pubsub = new RedisPubSub({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
  });
  logger.info('Initialized Redis Pub/Sub for users service');
  return pubsub;
}

export function getPubSub(): RedisPubSub {
  if (!pubsub) throw new Error('PubSub not initialized. Call initPubSub() first.');
  return pubsub;
}

export async function closePubSub(): Promise<void> {
  if (pubsub) {
    await pubsub.close();
    pubsub = null;
  }
}
