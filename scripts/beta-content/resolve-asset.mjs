// Orchestrates the provider fallback chain for a single content need (one
// photo for a post, or one video for a reel): try providers in priority
// order, score each provider's results, and return the best candidate found
// — or null if every provider came back empty/rejected, in which case the
// caller (db-writer.mjs) falls back to a local Blabber-branded generated
// asset (see local-assets.mjs), which is why this module itself has no
// "local" step — it only ever resolves *external* candidates.

import * as pexels from './providers/pexels.mjs';
import * as pixabay from './providers/pixabay.mjs';
import * as unsplash from './providers/unsplash.mjs';
import { selectTopCandidates } from './asset-score.mjs';

/**
 * Deterministic string -> [0,1) hash, matching content-plan.mjs's approach
 * (reproducible, not Math.random) — used only to decide which photo
 * provider is *tried first* for a given item, so that across many items the
 * overall source mix trends toward the task's target (~70%
 * Pexels/Pixabay, ~20% Unsplash) without needing a global rebalancing pass.
 */
function pseudoRandomUnit(seedKey) {
  let hash = 0;
  for (let i = 0; i < seedKey.length; i += 1) hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  return (hash % 1000) / 1000;
}

/**
 * Photo fallback chain: Pexels -> Unsplash -> Pixabay -> (caller falls back
 * to local). Unsplash is promoted to first place for ~35% of items (by
 * seedKey hash) to actually land near the task's ~20% content-mix target in
 * practice — not every "Unsplash first" attempt finds a scorable candidate
 * for a given query, so the roll needs to run higher than the target share
 * to compensate for that fallthrough rate.
 */
export function photoProviderOrder(seedKey) {
  const roll = pseudoRandomUnit(seedKey);
  if (roll < 0.35) return ['unsplash', 'pexels', 'pixabay'];
  if (roll < 0.7) return ['pexels', 'pixabay', 'unsplash'];
  return ['pixabay', 'pexels', 'unsplash'];
}

/** Video fallback chain: Pexels -> Pixabay only — Unsplash has no video API. */
export function videoProviderOrder() {
  return ['pexels', 'pixabay'];
}

const PROVIDER_MODULES = { pexels, pixabay, unsplash };

/**
 * Resolves one photo need by walking photoProviderOrder(seedKey), searching
 * each provider (candidatesPerProvider results), scoring with
 * selectTopCandidates, and returning the first non-empty pick. `apiKeys` is
 * `{pexels, pixabay, unsplash}` — a provider with no key configured is
 * skipped, not treated as an error (callers should have already validated
 * required keys are present via config.requireProviderKeys before reaching
 * here for the modes that need them).
 */
export async function resolvePhoto({ seedKey, query, topic, apiKeys, alreadyUsedAssetKeys, fetchImpl, candidatesPerProvider = 8 }) {
  const attempts = [];
  for (const provider of photoProviderOrder(seedKey)) {
    const apiKey = apiKeys?.[provider];
    if (!apiKey) {
      attempts.push({ provider, skipped: true, reason: 'no_api_key' });
      continue;
    }
    try {
      const candidates = await PROVIDER_MODULES[provider].searchPhotos({ query, perPage: candidatesPerProvider, apiKey, fetchImpl });
      const picks = selectTopCandidates(candidates, 1, { kind: 'photo', topic, alreadyUsedAssetKeys });
      attempts.push({ provider, found: candidates.length, picked: Boolean(picks[0]) });
      if (picks[0]) return { picked: picks[0], attempts };
    } catch (error) {
      attempts.push({ provider, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { picked: null, attempts };
}

/**
 * Same shape as resolvePhoto but for video needs (Pexels then Pixabay only).
 */
export async function resolveVideo({ seedKey, query, topic, apiKeys, alreadyUsedAssetKeys, fetchImpl, candidatesPerProvider = 6 }) {
  const attempts = [];
  for (const provider of videoProviderOrder()) {
    const apiKey = apiKeys?.[provider];
    if (!apiKey) {
      attempts.push({ provider, skipped: true, reason: 'no_api_key' });
      continue;
    }
    try {
      const candidates = await PROVIDER_MODULES[provider].searchVideos({ query, perPage: candidatesPerProvider, apiKey, fetchImpl });
      const picks = selectTopCandidates(candidates, 1, { kind: 'video', topic, alreadyUsedAssetKeys });
      attempts.push({ provider, found: candidates.length, picked: Boolean(picks[0]) });
      if (picks[0]) return { picked: picks[0], attempts };
    } catch (error) {
      attempts.push({ provider, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { picked: null, attempts };
}
