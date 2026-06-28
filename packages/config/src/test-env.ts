import { assertSafeTestDatabase } from './safe';

export interface TestServiceEnvOptions {
  service: string;
  port: number;
  defaultMongoUri?: string;
  defaultRedisHost?: string;
  defaultRedisPort?: string;
}

export function configureTestServiceEnv(options: TestServiceEnvOptions) {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL ||= 'error';
  process.env.PORT ||= String(options.port);
  process.env.ALLOWED_ORIGINS ||= 'http://localhost:3000';

  const dbName = process.env.TEST_MONGO_DB_NAME || process.env.TEST_MONGODB_DB_NAME || `test_${options.service}`;
  const mongoUri =
    process.env.TEST_MONGO_URI ||
    process.env.TEST_MONGODB_URI ||
    process.env.MONGO_URI ||
    options.defaultMongoUri ||
    'mongodb://localhost:27017';

  assertSafeTestDatabase(mongoUri, dbName);

  process.env.MONGO_URI = mongoUri;
  process.env.MONGO_DB_NAME = dbName;

  if (options.defaultRedisHost || process.env.TEST_REDIS_HOST || process.env.REDIS_HOST) {
    process.env.REDIS_HOST = process.env.TEST_REDIS_HOST || process.env.REDIS_HOST || options.defaultRedisHost || 'localhost';
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT || process.env.REDIS_PORT || options.defaultRedisPort || '6379';
  }

  process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-that-is-at-least-32-characters-long';
  process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-that-is-at-least-32-characters-long';
  process.env.JWT_ACCESS_TTL ||= '15m';
  process.env.JWT_REFRESH_TTL ||= '30d';
}
