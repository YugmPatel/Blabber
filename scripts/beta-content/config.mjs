// Shared configuration, env-key handling, and small constants for the beta
// content seed system (scripts/seed-beta-content.mjs and everything under
// scripts/beta-content/). Kept dependency-free (no dotenv import here) so
// pure-logic modules (asset-score.mjs, content-plan.mjs) can be unit tested
// without needing a real environment — the CLI entrypoint is responsible for
// calling dotenv.config() before anything in this file reads process.env.

// Distinct from the pre-existing 'blabber-demo-social' and
// 'pexels-demo-content' seed namespaces (scripts/seed-demo-social.mjs,
// scripts/import-pexels-demo-content.mjs) so all three seed catalogs can
// coexist and be independently identified, reported on, and removed.
export const SEED_NAMESPACE = 'beta-content-seed';
export const SEED_VERSION = '2026-07-beta-content-v1';

export const PROVIDER_ENV_KEYS = {
  pexels: 'PEXELS_API_KEY',
  pixabay: 'PIXABAY_API_KEY',
  unsplash: 'UNSPLASH_ACCESS_KEY',
};

const SETUP_INSTRUCTIONS = {
  PEXELS_API_KEY: 'Get a free key at https://www.pexels.com/api/ and set PEXELS_API_KEY in your .env (never commit it).',
  PIXABAY_API_KEY: 'Get a free key at https://pixabay.com/api/docs/ and set PIXABAY_API_KEY in your .env (never commit it).',
  UNSPLASH_ACCESS_KEY: 'Create an app at https://unsplash.com/developers and set UNSPLASH_ACCESS_KEY (the "Access Key", not the secret) in your .env (never commit it).',
};

/**
 * Returns which of the three provider keys are present, without ever
 * exposing the key values themselves — only presence/absence booleans are
 * safe to log.
 */
export function providerKeyStatus(env = process.env) {
  return Object.fromEntries(
    Object.entries(PROVIDER_ENV_KEYS).map(([provider, envKey]) => [provider, Boolean(env[envKey])])
  );
}

/**
 * Throws a clear, actionable error (with setup instructions, never the key
 * value) if any of the given providers' keys are missing. Pass a subset of
 * ['pexels', 'pixabay', 'unsplash'] to check only what a given mode needs —
 * e.g. --report/--reset never need any provider key at all.
 */
export function requireProviderKeys(providers, env = process.env) {
  const missing = providers.filter((provider) => !env[PROVIDER_ENV_KEYS[provider]]);
  if (missing.length === 0) return;
  const lines = missing.map((provider) => {
    const envKey = PROVIDER_ENV_KEYS[provider];
    return `  - ${envKey} is not set. ${SETUP_INSTRUCTIONS[envKey]}`;
  });
  throw new Error(
    [
      `Missing required provider API key(s): ${missing.map((p) => PROVIDER_ENV_KEYS[p]).join(', ')}`,
      ...lines,
      '',
      'Add these to your local .env file (never commit it) and re-run.',
    ].join('\n')
  );
}

export const MIN_PHOTO_WIDTH = 1080;
export const VIDEO_MIN_DURATION_SECONDS = 5;
export const VIDEO_MAX_DURATION_SECONDS = 20;
export const MAX_PHOTO_BYTES = 18 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 45 * 1024 * 1024;

export const REQUIRED_INVENTORY = {
  demoAccounts: 10,
  feedPosts: 60,
  reels: 30,
  discoverTopics: 10,
  reactionsMin: 80,
  reactionsMax: 150,
  commentsMin: 25,
  commentsMax: 40,
};

export const REEL_CATEGORY_TARGETS = {
  onboarding: 5,
  campus: 5,
  tech: 5,
  food: 4,
  travel: 4,
  productivity: 4,
  events: 3,
};

export function mediaServicePort(env = process.env) {
  return Number(env.MEDIA_SERVICE_PORT || env.PORT || 3005);
}

export function mongoUri(env = process.env) {
  return env.MONGO_URI || 'mongodb://mongodb:27017';
}

export function mongoDbName(env = process.env) {
  return env.MONGO_DB_NAME || 'blabber_full';
}

export function localMediaRoot(env = process.env) {
  return env.LOCAL_MEDIA_DIR || '/data/blabber-media';
}
