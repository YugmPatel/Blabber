import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS, accountByHandle } from '../accounts.mjs';

const EXPECTED_HANDLES = [
  'blabber',
  'campusdaily',
  'studyhub',
  'techbytes',
  'startupnotes',
  'foodfinds',
  'sanjoseevents',
  'travelcircle',
  'designlab',
  'housinghelp',
];

describe('DEMO_ACCOUNTS', () => {
  it('has exactly the 10 handles specified in the task', () => {
    expect(DEMO_ACCOUNTS.map((account) => account.handle)).toEqual(EXPECTED_HANDLES);
  });

  it('every account has a non-empty display name and bio distinct from a raw username', () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.name).not.toBe(account.handle);
      expect(account.name.length).toBeGreaterThan(0);
      expect(account.bio.length).toBeGreaterThan(10);
    }
  });

  it('handles are all lowercase with no spaces or @ symbol (raw username, not a display handle)', () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.handle).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('bios read as community/brand accounts, not first-person "I" statements from a private individual', () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.bio.toLowerCase()).not.toMatch(/\bi\s+am\b|\bmy\s+life\b/);
    }
  });
});

describe('accountByHandle', () => {
  it('looks up a known account', () => {
    expect(accountByHandle('blabber').name).toBe('Blabber');
  });

  it('throws a clear error for an unknown handle', () => {
    expect(() => accountByHandle('does-not-exist')).toThrow(/Unknown demo account handle/);
  });
});
