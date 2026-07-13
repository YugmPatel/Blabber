import { configureTestServiceEnv } from '@repo/config';

configureTestServiceEnv({ service: 'chats', port: 3003, defaultRedisHost: 'localhost', defaultRedisPort: '6379' });
process.env.OPENROUTER_MOCK_FALLBACK = 'true';
