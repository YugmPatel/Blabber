import { z } from 'zod';
import { isProduction, requireSafeParse, throwConfigError } from './safe';

const JWTConfigSchema = z.object({
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
});

export type JWTConfig = z.infer<typeof JWTConfigSchema>;

export function loadJWTConfig(): JWTConfig {
  const config = requireSafeParse('jwt', JWTConfigSchema, process.env) as JWTConfig;

  if (
    isProduction() &&
    [config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET].some((secret) =>
      /test|dev|development|secret/i.test(secret)
    )
  ) {
    throwConfigError('jwt', [
      {
        path: 'JWT_ACCESS_SECRET/JWT_REFRESH_SECRET',
        message: 'Production JWT secrets must not use development or test-looking values',
      },
    ]);
  }

  return config;
}
