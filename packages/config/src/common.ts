import { z } from 'zod';
import { requireSafeParse } from './safe';

const CommonConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
});

export type CommonConfig = z.infer<typeof CommonConfigSchema>;

export function loadCommonConfig(): CommonConfig {
  return requireSafeParse('common', CommonConfigSchema, process.env) as CommonConfig;
}
