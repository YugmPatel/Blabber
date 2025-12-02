import { z } from 'zod';

const CommonConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
});

export type CommonConfig = z.infer<typeof CommonConfigSchema>;

export function loadCommonConfig(): CommonConfig {
  const result = CommonConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid common configuration:', result.error.format());
    throw new Error('Invalid common configuration');
  }
  
  return result.data;
}
