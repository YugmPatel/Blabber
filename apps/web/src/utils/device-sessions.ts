import type { DeviceSession } from '@/api/client';

export interface DeviceSessionGroup {
  key: string;
  label: string;
  browser?: string;
  operatingSystem?: string;
  deviceType?: DeviceSession['deviceType'];
  current: boolean;
  lastActiveAt: string;
  sessions: DeviceSession[];
}

function timestamp(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function activityTimestamp(session: DeviceSession) {
  return timestamp(session.lastActiveAt || session.createdAt);
}

export function getActiveDeviceSessions(sessions: DeviceSession[], now = Date.now()) {
  return sessions
    .filter((session) => {
      if (session.status === 'revoked' || session.status === 'expired') return false;
      const expiresAt = timestamp(session.expiresAt);
      return expiresAt > now;
    })
    .sort((left, right) => activityTimestamp(right) - activityTimestamp(left));
}

function groupingKey(session: DeviceSession) {
  // The current session stays on its own so it is never hidden inside a group
  // that can be revoked remotely.
  if (session.current) return `current:${session.id}`;

  const userAgent = session.userAgent?.trim();
  if (!userAgent || userAgent.toLowerCase() === 'unknown') {
    // A generic label is not enough evidence that two rows are one device.
    return `session:${session.id}`;
  }

  return [
    'device',
    session.browser || '',
    session.operatingSystem || '',
    session.deviceType || '',
    userAgent,
  ].join('\u0000');
}

export function groupActiveDeviceSessions(sessions: DeviceSession[], now = Date.now()) {
  const activeSessions = getActiveDeviceSessions(sessions, now);
  const groups = new Map<string, DeviceSessionGroup>();

  for (const session of activeSessions) {
    const key = groupingKey(session);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }

    groups.set(key, {
      key,
      label: session.label || 'Unknown device',
      browser: session.browser,
      operatingSystem: session.operatingSystem,
      deviceType: session.deviceType,
      current: session.current,
      lastActiveAt: session.lastActiveAt || session.createdAt,
      sessions: [session],
    });
  }

  return { activeSessions, groups: Array.from(groups.values()) };
}
