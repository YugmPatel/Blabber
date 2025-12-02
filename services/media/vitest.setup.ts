// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.PORT = '3005';
process.env.MONGO_URI = 'mongodb://localhost:27017';
process.env.MONGO_DB_NAME = 'whatsapp_test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_PASSWORD = '';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.S3_REGION = 'us-east-1';
process.env.S3_MEDIA_BUCKET = 'test-media-bucket';
process.env.MEDIA_BASE_URL = 'https://test.cloudfront.net';
