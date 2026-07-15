// Stable seedKey generation and the deterministic seedKey -> Mongo ObjectId
// hash, matching the pattern already proven in scripts/seed-demo-social.mjs
// and scripts/import-pexels-demo-content.mjs (idFor(kind, value)) — reusing
// the exact same approach keeps this new seed system idempotent the same
// way: re-running always resolves to the same _id for the same seedKey, so
// every write becomes a $setOnInsert/$set upsert instead of a duplicate
// insert.

import { createHash } from 'node:crypto';
import { SEED_NAMESPACE } from './config.mjs';

function pad3(index) {
  return String(index + 1).padStart(3, '0');
}

/**
 * Human-readable, stable identifiers per content kind. Examples match the
 * task spec exactly: beta-user-blabber, beta-topic-tech-ai,
 * beta-post-studyhub-001, beta-reel-campusdaily-003,
 * beta-comment-techbytes-002.
 */
export function seedKeyFor(kind, ...parts) {
  switch (kind) {
    case 'user':
      return `beta-user-${parts[0]}`;
    case 'topic':
      return `beta-topic-${String(parts[0]).replace(/_/g, '-')}`;
    case 'post':
      return `beta-post-${parts[0]}-${pad3(parts[1])}`;
    case 'avatar':
      return `beta-avatar-${parts[0]}`;
    case 'card':
      return `beta-card-${parts[0]}-${pad3(parts[1])}`;
    case 'reel':
      return `beta-reel-${parts[0]}-${pad3(parts[1])}`;
    case 'comment':
      return `beta-comment-${parts[0]}-${pad3(parts[1])}`;
    case 'reaction':
      return `beta-reaction-${parts[0]}-${parts[1]}`;
    case 'follow':
      return `beta-follow-${parts[0]}-${parts[1]}`;
    default:
      throw new Error(`Unknown seedKey kind: ${kind}`);
  }
}

/**
 * Deterministic 24-hex-char id derived from a seedKey (and an optional
 * sub-kind, e.g. 'media' vs 'post' for the same post seedKey, since a single
 * post needs both a media _id and a post _id). Must be paired with an
 * ObjectId constructor by the caller (kept dependency-free here so this
 * module has zero I/O and can be unit tested without the mongodb package).
 */
export function idHexFor(seedKey, subKind = 'primary') {
  return createHash('sha1').update(`${SEED_NAMESPACE}:${subKind}:${seedKey}`).digest('hex').slice(0, 24);
}
