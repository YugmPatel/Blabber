import { z } from 'zod';

const CORSConfigSchema = z.object({
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required'),
});

export type CORSConfig = z.infer<typeof CORSConfigSchema>;

export interface ParsedCORSConfig {
  origins: string[];
}

export function loadCORSConfig(): ParsedCORSConfig {
  const result = CORSConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid CORS configuration:', result.error.format());
    throw new Error('Invalid CORS configuration');
  }
  
  // Parse comma-separated origins
  const origins = result.data.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  
  return { origins };
}
