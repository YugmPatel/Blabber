process.env.NODE_ENV = 'test';
process.env.REDIS_HOST ||= process.env.TEST_REDIS_HOST || 'localhost';
process.env.REDIS_PORT ||= process.env.TEST_REDIS_PORT || '6379';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-that-is-at-least-32-characters-long';
