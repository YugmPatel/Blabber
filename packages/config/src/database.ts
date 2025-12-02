import { z } from 'zod';

const DatabaseConfigSchema = z.object({
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_DB_NAME: z.string().min(1, 'MONGO_DB_NAME is required'),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export function loadDatabaseConfig(): DatabaseConfig {
  const result = DatabaseConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid database configuration:', result.error.format());
    throw new Error('Invalid database configuration');
  }
  
  return result.data;
}
