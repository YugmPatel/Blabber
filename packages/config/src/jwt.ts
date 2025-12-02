import { z } from 'zod';

const JWTConfigSchema = z.object({
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
});

export type JWTConfig = z.infer<typeof JWTConfigSchema>;

export function loadJWTConfig(): JWTConfig {
  const result = JWTConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid JWT configuration:', result.error.format());
    throw new Error('Invalid JWT configuration');
  }
  
  return result.data;
}
