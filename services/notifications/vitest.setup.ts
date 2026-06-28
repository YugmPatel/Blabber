import { configureTestServiceEnv } from '@repo/config';

configureTestServiceEnv({ service: 'notifications', port: 3006 });
process.env.VAPID_PUBLIC_KEY ||= 'test-vapid-public-key';
process.env.VAPID_PRIVATE_KEY ||= 'test-vapid-private-key';
process.env.VAPID_SUBJECT ||= 'mailto:test@example.com';
