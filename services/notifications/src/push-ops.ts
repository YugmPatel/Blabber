export interface PushCounters {
  attempted: number;
  delivered: number;
  skipped: number;
  expired: number;
  failed: number;
}

const counters: PushCounters = {
  attempted: 0,
  delivered: 0,
  skipped: 0,
  expired: 0,
  failed: 0,
};

export function pushOperationalStatus() {
  const enabled = process.env.PUSH_NOTIFICATIONS_ENABLED !== 'false';
  const mockMode = process.env.PUSH_MOCK_MODE === 'true';
  const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  return {
    enabled,
    mockMode,
    configured,
    mode: !enabled ? 'disabled' : mockMode ? 'mock' : configured ? 'web-push' : 'unconfigured',
    counters: { ...counters },
  };
}

export function validatePushStartupConfig() {
  const status = pushOperationalStatus();
  if (process.env.NODE_ENV === 'production' && status.enabled && !status.mockMode && !status.configured) {
    throw new Error('Push notifications are enabled but VAPID is not configured');
  }
  return status;
}

export function incrementPushCounter(key: keyof PushCounters, by = 1) {
  counters[key] += by;
}
