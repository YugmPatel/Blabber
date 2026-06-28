import { beforeAll, afterAll } from 'vitest';
import { configureTestServiceEnv } from '@repo/config';

configureTestServiceEnv({
  service: 'users',
  port: 3002,
  defaultRedisHost: 'localhost',
  defaultRedisPort: '6379',
});

beforeAll(() => {
  // Setup code if needed
});

afterAll(() => {
  // Cleanup code if needed
});
