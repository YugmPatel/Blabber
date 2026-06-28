import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { compareRefreshToken, hashRefreshToken } from './device-session';

describe('refresh token hashing', () => {
  it('distinguishes tokens that only differ after bcrypt truncation length', async () => {
    const token = `${'x'.repeat(72)}first-token-suffix`;
    const collidingPrefixToken = `${'x'.repeat(72)}second-token-suffix`;

    const hash = await hashRefreshToken(token);

    expect(await compareRefreshToken(token, hash)).toBe(true);
    expect(await compareRefreshToken(collidingPrefixToken, hash)).toBe(false);
  });

  it('does not accept legacy hashes created from the raw refresh token', async () => {
    const token = `${'legacy-token.'.repeat(8)}suffix`;
    const legacyHash = await bcrypt.hash(token, 10);

    expect(await compareRefreshToken(token, legacyHash)).toBe(false);
  });
});
