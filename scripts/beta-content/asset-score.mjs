// Pure scoring/filtering logic for candidate photo/video assets returned by
// the provider modules. Nothing here performs I/O — every function takes
// plain data in and returns plain data out, so it's fully unit-testable
// without mocking fetch or a database.

import { MIN_PHOTO_WIDTH, VIDEO_MAX_DURATION_SECONDS, VIDEO_MIN_DURATION_SECONDS } from './config.mjs';

// Real pipeline hard limits (services/media's reel-processing.ts) — a video
// outside this range would be rejected by the actual upload pipeline during
// --apply, so there's no point scoring it as a candidate at all.
const PIPELINE_MIN_DURATION_SECONDS = 3;
const PIPELINE_MAX_DURATION_SECONDS = 90;
const PIPELINE_MAX_DIMENSION = 1920;

// Provider source-quality weighting per the task's content mix (Pexels
// primary, Pixabay fallback, Unsplash a distinct high-quality photo-only
// source) — used only to break near-ties, not as a hard gate.
const PROVIDER_WEIGHT = { pexels: 3, unsplash: 2, pixabay: 1 };

// Cheap, deliberately conservative text-based safety net. Provider search
// calls already pass safesearch/curated-content parameters (see
// providers/*.mjs) — this is a second, defensive layer, not the primary
// control, since real content moderation of image/video pixels is out of
// scope for a metadata-only scorer.
const UNSAFE_TERM_PATTERN = /\b(nude|nudity|explicit|nsfw|gun|weapon|violence|blood|gore|drug|alcohol\s*brand)\b/i;
const TEXT_HEAVY_HINT_PATTERN = /\b(meme|quote|poster|infographic|screenshot|logo|banner\s*ad)\b/i;

function assetKey(candidate) {
  return `${candidate.provider}:${candidate.sourceAssetId}`;
}

function textFieldsOf(candidate) {
  return [candidate.alt, candidate.tags, candidate.photographer].filter(Boolean).join(' ');
}

/**
 * Scores a single photo candidate. Returns { score, rejected, reasons }.
 * `rejected: true` means this candidate must never be selected regardless of
 * score (a hard filter); `reasons` explains why, for --dry-run reporting.
 */
export function scorePhoto(candidate, { topic, alreadyUsedAssetKeys = new Set() } = {}) {
  const reasons = [];
  if (!candidate?.downloadUrl) reasons.push('missing_download_url');
  if (!candidate?.width || !candidate?.height) reasons.push('missing_dimensions');
  if (candidate?.width && candidate.width < MIN_PHOTO_WIDTH) reasons.push('below_min_width');
  if (alreadyUsedAssetKeys.has(assetKey(candidate))) reasons.push('duplicate_asset');
  const text = textFieldsOf(candidate);
  if (UNSAFE_TERM_PATTERN.test(text)) reasons.push('unsafe_term_match');
  if (TEXT_HEAVY_HINT_PATTERN.test(text)) reasons.push('text_heavy_hint');

  if (reasons.length > 0) return { score: 0, rejected: true, reasons };

  let score = 0;
  score += PROVIDER_WEIGHT[candidate.provider] || 0;
  // Resolution bonus, capped so a huge image doesn't dominate purely on size.
  score += Math.min(candidate.width / MIN_PHOTO_WIDTH, 3) * 2;
  // Landscape/near-square is the natural fit for a feed photo card; a very
  // tall portrait crops awkwardly there, so it's scored down, not rejected.
  const aspect = candidate.width / candidate.height;
  if (aspect >= 0.9) score += 2;
  if (topic && text && topic.searchQueries?.some((query) => text.toLowerCase().includes(query.split(' ')[0]))) {
    score += 1;
  }
  return { score, rejected: false, reasons: [] };
}

/**
 * Scores a single video candidate the same way, tuned for the Reels
 * pipeline's real constraints (duration/dimension ceilings the actual
 * upload route would enforce) plus the task's 5-20s target band and
 * portrait-orientation preference.
 */
export function scoreVideo(candidate, { topic, alreadyUsedAssetKeys = new Set() } = {}) {
  const reasons = [];
  if (!candidate?.downloadUrl) reasons.push('missing_download_url');
  if (!candidate?.width || !candidate?.height) reasons.push('missing_dimensions');
  const duration = Number(candidate?.durationSeconds) || 0;
  if (duration < PIPELINE_MIN_DURATION_SECONDS || duration > PIPELINE_MAX_DURATION_SECONDS) reasons.push('duration_outside_pipeline_limits');
  if (candidate?.width > PIPELINE_MAX_DIMENSION || candidate?.height > PIPELINE_MAX_DIMENSION) reasons.push('exceeds_max_dimension');
  if (alreadyUsedAssetKeys.has(assetKey(candidate))) reasons.push('duplicate_asset');
  const text = textFieldsOf(candidate);
  if (UNSAFE_TERM_PATTERN.test(text)) reasons.push('unsafe_term_match');

  if (reasons.length > 0) return { score: 0, rejected: true, reasons };

  let score = 0;
  score += PROVIDER_WEIGHT[candidate.provider] || 0;
  // Duration-target bonus: full marks inside [5,20]s, tapering off outside.
  if (duration >= VIDEO_MIN_DURATION_SECONDS && duration <= VIDEO_MAX_DURATION_SECONDS) {
    score += 4;
  } else {
    const distance = duration < VIDEO_MIN_DURATION_SECONDS ? VIDEO_MIN_DURATION_SECONDS - duration : duration - VIDEO_MAX_DURATION_SECONDS;
    score += Math.max(4 - distance * 0.3, 0);
  }
  // Portrait bonus for Reels; horizontal is still accepted (per task) but
  // scored lower so it's only picked when nothing portrait is available.
  if (candidate.height >= candidate.width) score += 3;
  // Mild file-size-safety proxy: very high resolution video is more likely
  // to be a huge file even before we've downloaded it.
  const megapixels = (candidate.width * candidate.height) / 1_000_000;
  if (megapixels > 2) score -= (megapixels - 2) * 0.5;
  if (topic && text && topic.searchQueries?.some((query) => text.toLowerCase().includes(query.split(' ')[0]))) {
    score += 1;
  }
  return { score, rejected: false, reasons: [] };
}

/**
 * Filters out rejected candidates, sorts the rest by score descending, and
 * returns up to `count` picks. Does not mutate `alreadyUsedAssetKeys` — the
 * caller decides when a pick becomes "used" (e.g. only after a successful
 * apply-time download+upload, not merely because it scored well in
 * dry-run).
 */
export function selectTopCandidates(candidates, count, { kind, topic, alreadyUsedAssetKeys = new Set() } = {}) {
  const scoreFn = kind === 'video' ? scoreVideo : scorePhoto;
  return candidates
    .map((candidate) => ({ candidate, ...scoreFn(candidate, { topic, alreadyUsedAssetKeys }) }))
    .filter((entry) => !entry.rejected)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.candidate);
}

export function candidateAssetKey(candidate) {
  return assetKey(candidate);
}
