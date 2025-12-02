import { beforeAll, afterAll } from 'vitest';

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PORT = '3002';
process.env.MONGO_URI = 'mongodb://localhost:27017';
process.env.MONGO_DB_NAME = 'whatsapp_test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

beforeAll(() => {
  // Setup code if needed
});

afterAll(() => {
  // Cleanup code if needed
});
