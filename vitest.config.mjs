import { defineConfig } from 'vitest/config';

// Root-level vitest config, scoped to scripts/beta-content only — every
// other package in this monorepo has its own vitest config and is tested
// via `pnpm --filter <package> test`. This exists purely so the beta
// content seed system's pure logic (scoring, content-plan, provider
// parsing) can be unit tested without turning scripts/ into a full
// workspace package. Run with `pnpm test:beta-content`.
export default defineConfig({
  test: {
    include: ['scripts/beta-content/**/*.test.mjs'],
    environment: 'node',
    globals: false,
  },
});
