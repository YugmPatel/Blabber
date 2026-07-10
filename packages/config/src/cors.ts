import { z } from 'zod';
import { requireSafeParse } from './safe';

const CORSConfigSchema = z.object({
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required'),
  CORS_CREDENTIALS: z.string().optional().default('true'),
});

export type CORSConfig = z.infer<typeof CORSConfigSchema>;

export interface ParsedCORSConfig {
  origins: string[];
  credentials: boolean;
}

export function loadCORSConfig(): ParsedCORSConfig {
  const result = requireSafeParse('cors', CORSConfigSchema, process.env);
  const origins = result.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  const credentials = result.CORS_CREDENTIALS !== 'false';

  if (credentials && origins.includes('*')) {
    throw new Error('cors configuration is invalid: wildcard origins cannot be used with credentials');
  }
  
  return { origins, credentials };
}
