import { z } from 'zod';
import { requireSafeParse } from './safe';

const CORSConfigSchema = z.object({
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required'),
});

export type CORSConfig = z.infer<typeof CORSConfigSchema>;

export interface ParsedCORSConfig {
  origins: string[];
}

export function loadCORSConfig(): ParsedCORSConfig {
  const result = requireSafeParse('cors', CORSConfigSchema, process.env);
  // Parse comma-separated origins
  const origins = result.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  
  return { origins };
}
