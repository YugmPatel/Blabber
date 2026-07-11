import { describe, expect, it } from 'vitest';
import type { DeviceSession } from '@/api/client';
import { groupActiveDeviceSessions } from './device-sessions';

const NOW = Date.parse('2026-07-10T20:00:00.000Z');

function session(overrides: Partial<DeviceSession> = {}): DeviceSession {
  return {
    id: 'session-1',
    label: 'Chrome on macOS',
    browser: 'Chrome',
    operatingSystem: 'macOS',
    deviceType: 'desktop',
    userAgent: 'Chrome/149 macOS',
    createdAt: '2026-07-10T18:00:00.000Z',
    lastActiveAt: '2026-07-10T19:00:00.000Z',
    expiresAt: '2026-07-17T20:00:00.000Z',
    current: false,
    status: 'active',
    ...overrides,
  };
}

describe('groupActiveDeviceSessions', () => {
  it('filters revoked and expired sessions and sorts by recent activity', () => {
    const result = groupActiveDeviceSessions([
      session({ id: 'older', lastActiveAt: '2026-07-10T18:30:00.000Z' }),
      session({ id: 'revoked', status: 'revoked' }),
      session({ id: 'expired-status', status: 'expired' }),
      session({ id: 'expired-date', expiresAt: '2026-07-10T19:59:59.000Z' }),
      session({ id: 'newer', userAgent: 'Safari/26 macOS', lastActiveAt: '2026-07-10T19:30:00.000Z' }),
    ], NOW);

    expect(result.activeSessions.map(({ id }) => id)).toEqual(['newer', 'older']);
  });

  it('groups only exact known user agents and reports every raw session', () => {
    const result = groupActiveDeviceSessions([
      session({ id: 'one' }),
      session({ id: 'two', lastActiveAt: '2026-07-10T18:00:00.000Z' }),
      session({ id: 'other-version', userAgent: 'Chrome/150 macOS' }),
      session({ id: 'unknown-one', userAgent: 'unknown' }),
      session({ id: 'unknown-two', userAgent: 'unknown' }),
    ], NOW);

    expect(result.groups.map((group) => group.sessions.map(({ id }) => id))).toEqual([
      ['one', 'two'],
      ['other-version'],
      ['unknown-one'],
      ['unknown-two'],
    ]);
    expect(result.activeSessions).toHaveLength(5);
  });

  it('always separates the current session from matching remote sessions', () => {
    const result = groupActiveDeviceSessions([
      session({ id: 'current', current: true }),
      session({ id: 'remote' }),
    ], NOW);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({ current: true, sessions: [{ id: 'current' }] });
    expect(result.groups[1]).toMatchObject({ current: false, sessions: [{ id: 'remote' }] });
  });
});
