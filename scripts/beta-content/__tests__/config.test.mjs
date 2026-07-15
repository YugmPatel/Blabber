import { describe, expect, it } from 'vitest';
import { providerKeyStatus, requireProviderKeys } from '../config.mjs';

describe('providerKeyStatus', () => {
  it('reports which provider keys are present without exposing their values', () => {
    const status = providerKeyStatus({ PEXELS_API_KEY: 'secret-value', PIXABAY_API_KEY: '', UNSPLASH_ACCESS_KEY: undefined });
    expect(status).toEqual({ pexels: true, pixabay: false, unsplash: false });
  });
});

describe('requireProviderKeys', () => {
  it('does not throw when every requested key is present', () => {
    const env = { PEXELS_API_KEY: 'a', PIXABAY_API_KEY: 'b', UNSPLASH_ACCESS_KEY: 'c' };
    expect(() => requireProviderKeys(['pexels', 'pixabay', 'unsplash'], env)).not.toThrow();
  });

  it('throws a clear, actionable error listing exactly which keys are missing', () => {
    const env = { PEXELS_API_KEY: 'a' };
    let thrown;
    try {
      requireProviderKeys(['pexels', 'pixabay', 'unsplash'], env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain('PIXABAY_API_KEY');
    expect(thrown.message).toContain('UNSPLASH_ACCESS_KEY');
    expect(thrown.message).not.toContain('PEXELS_API_KEY is not set'); // pexels was present, must not be listed as missing
  });

  it('never includes an actual key value in the thrown error message', () => {
    const env = { PEXELS_API_KEY: 'super-secret-key-value-12345' };
    let thrown;
    try {
      requireProviderKeys(['pexels', 'pixabay'], env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown.message).not.toContain('super-secret-key-value-12345');
  });

  it('only checks the providers actually requested (e.g. --report mode needs none)', () => {
    expect(() => requireProviderKeys([], {})).not.toThrow();
  });
});
