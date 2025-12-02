import { z } from 'zod';

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

  const result = vapidConfigSchema.safeParse(config);

  if (!result.success) {
    console.error('❌ Invalid VAPID configuration:', result.error.format());
    throw new Error('Invalid VAPID configuration');
  }

  return result.data;
}
