// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.PORT = '3001';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.MONGO_URI = 'mongodb://localhost:27017';
process.env.MONGO_DB_NAME = 'test_db';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-characters-long';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';
