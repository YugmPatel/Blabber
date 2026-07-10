#!/usr/bin/env node
const dryRun = process.argv.includes('--dry-run');
if (!dryRun) {
  console.error('verify-release-candidate is provider-neutral and currently requires --dry-run. Use the listed command contract in CI after a provider is selected.');
  process.exit(2);
}

const commands = [
  'corepack pnpm install --frozen-lockfile',
  'corepack pnpm build',
  'corepack pnpm lint',
  'corepack pnpm test',
  'corepack pnpm --filter @services/media test',
  'corepack pnpm mobile:typecheck',
  'corepack pnpm mobile:lint',
  'corepack pnpm mobile:test',
  'corepack pnpm mobile:config-check',
  'corepack pnpm mobile:export:android',
  'corepack pnpm mobile:export:ios',
  'corepack pnpm smoke:release-a',
  'corepack pnpm smoke:release-b-account',
  'corepack pnpm smoke:release-b-safety',
  'corepack pnpm smoke:release-b-operations',
  'corepack pnpm smoke:release-c-moments',
  'corepack pnpm smoke:release-c-moment-interactions',
  'corepack pnpm smoke:release-d-profiles',
  'corepack pnpm smoke:release-d-feed',
  'corepack pnpm smoke:release-d-communities',
  'corepack pnpm smoke:release-d-discovery',
  'corepack pnpm smoke:release-d-for-you',
  'corepack pnpm smoke:release-e-video-foundation',
  'corepack pnpm smoke:release-e-reels-viewer',
  'corepack pnpm smoke:release-e-reels-for-you',
  'corepack pnpm smoke:release-f-mobile-foundation',
  'corepack pnpm smoke:release-f-mobile-social',
  'corepack pnpm smoke:release-f-mobile-reliability',
  'corepack pnpm smoke:release-g-cross-platform-qa',
  'corepack pnpm smoke:release-g-hardening',
  'corepack pnpm verify:production-config -- --fixture scripts/fixtures/production-config.valid.json',
  'corepack pnpm verify:launch-gate',
];

console.log(JSON.stringify({
  contract: 'release-candidate',
  mode: 'dry-run',
  deploys: false,
  uploadsArtifacts: false,
  callsExternalProviders: false,
  commands,
}, null, 2));
