import { z } from 'zod';

const RedisConfigSchema = z.object({
  REDIS_HOST: z.string().min(1, 'REDIS_HOST is required'),
  REDIS_PORT: z.coerce.number().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

export function loadRedisConfig(): RedisConfig {
  const result = RedisConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid Redis configuration:', result.error.format());
    throw new Error('Invalid Redis configuration');
  }
  
  return result.data;
}
