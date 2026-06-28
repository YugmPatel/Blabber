import { z } from 'zod';
import { requireSafeParse } from './safe';

const vapidConfigSchema = z.object({
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().email().or(z.string().url()),
});

export type VAPIDConfig = z.infer<typeof vapidConfigSchema>;

export function loadVAPIDConfig(): VAPIDConfig {
  const config = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  };

  return requireSafeParse('vapid', vapidConfigSchema, config);
}
