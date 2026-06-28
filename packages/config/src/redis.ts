import { z } from 'zod';
import { isProduction, requireSafeParse, throwConfigError } from './safe';

const RedisConfigSchema = z.object({
  REDIS_HOST: z.string().min(1, 'REDIS_HOST is required'),
  REDIS_PORT: z.coerce.number().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

export function loadRedisConfig(): RedisConfig {
  const config = requireSafeParse('redis', RedisConfigSchema, process.env) as RedisConfig;

  if (isProduction() && ['localhost', '127.0.0.1'].includes(config.REDIS_HOST)) {
    throwConfigError('redis', [
      {
        path: 'REDIS_HOST',
        message: 'Production Redis host cannot be localhost',
      },
    ]);
  }

  return config;
}
