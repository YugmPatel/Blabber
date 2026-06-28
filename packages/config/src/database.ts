import { z } from 'zod';
import { assertSafeTestDatabase, isProduction, requireSafeParse, throwConfigError } from './safe';

const DatabaseConfigSchema = z.object({
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_DB_NAME: z.string().min(1, 'MONGO_DB_NAME is required'),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export function loadDatabaseConfig(): DatabaseConfig {
  const config = requireSafeParse('database', DatabaseConfigSchema, process.env);

  if (process.env.NODE_ENV === 'test') {
    assertSafeTestDatabase(config.MONGO_URI, config.MONGO_DB_NAME);
  }

  if (isProduction() && /localhost|127\.0\.0\.1/.test(config.MONGO_URI)) {
    throwConfigError('database', [
      {
        path: 'MONGO_URI',
        message: 'Production MongoDB URI cannot point at localhost',
      },
    ]);
  }

  return config;
}
