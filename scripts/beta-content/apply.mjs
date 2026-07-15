// --apply orchestration: builds the content plan, resolves every photo/video
// need against the provider fallback chain (falling back to a local
// Blabber-branded generated asset when nothing external clears
// asset-score.mjs's filters), and then performs every write via
// db-writer.mjs in dependency order (accounts -> posts -> reels -> comments
// -> reactions -> follows). Runs only inside the media Docker container
// (see seed-beta-content.mjs) since it needs Mongo, LOCAL_MEDIA_DIR, and the
// media service's own HTTP port.

import { createRequire } from 'node:module';
import { buildContentPlan } from './content-plan.mjs';
import { resolvePhotoCandidates, resolveVideoCandidates } from './resolve-asset.mjs';
import { candidateAssetKey } from './asset-score.mjs';
import { topicBySlug } from './topics.mjs';
import { buildInventoryReport, checkFfmpegAvailable, enforceMinimumInventory } from './inventory.mjs';
import { applyComment, applyFollow, applyPost, applyReaction, applyReel, ensureAccount, ensureAccountIdentityAssets, idFor } from './db-writer.mjs';
import { failureSummary, pickFirstValidCandidate } from './media-preflight.mjs';

async function makeProcessReels() {
  const require = createRequire(import.meta.url);
  return async function processReels() {
    const { connectToDatabase, closeDatabase } = require('/app/services/media/dist/db.js');
    const { processOnePendingReel } = require('/app/services/media/dist/reel-processing.js');
    await connectToDatabase();
    try {
      for (let i = 0; i < 3; i += 1) {
        const processed = await processOnePendingReel();
        if (!processed) break;
      }
    } finally {
      await closeDatabase();
    }
  };
}

export async function applyContentPlan(db, ObjectId, { env, jwtAccessSecret, port }) {
  const apiKeys = { pexels: env.PEXELS_API_KEY, pixabay: env.PIXABAY_API_KEY, unsplash: env.UNSPLASH_ACCESS_KEY };
  const now = new Date();
  const plan = buildContentPlan();
  const usedAssetKeys = new Set();
  const processReels = await makeProcessReels();
  const candidateFailures = [];

  if (!checkFfmpegAvailable()) {
    throw new Error('ERROR: ffmpeg is not available inside the media container — cannot generate local fallback assets or process reel video. Aborting before any writes.');
  }

  // 1. Accounts first — everything else references them.
  const accountsByHandle = new Map();
  const identityAssets = [];
  for (let ordinal = 0; ordinal < plan.accounts.length; ordinal += 1) {
    const accountSpec = plan.accounts[ordinal];
    const user = await ensureAccount(db, { ObjectId, accountSpec, now });
    const assets = await ensureAccountIdentityAssets(db, ObjectId, { accountSpec, user, env, jwtAccessSecret, ordinal, now });
    identityAssets.push({ handle: accountSpec.handle, ...assets });
    accountsByHandle.set(accountSpec.handle, user);
  }

  // 2. Posts — resolve a photo, then apply through the real upload pipeline.
  const postResolutions = [];
  const postIdBySeedKey = new Map();
  for (let ordinal = 0; ordinal < plan.posts.length; ordinal += 1) {
    const postSpec = plan.posts[ordinal];
    const topic = topicBySlug(postSpec.topicSlug);
    const resolution = postSpec.localAsset
      ? { candidates: [], attempts: [{ provider: 'generated', skipped: true, reason: 'seed-owned branded card' }] }
      : await resolvePhotoCandidates({ seedKey: postSpec.seedKey, query: postSpec.searchQuery, topic, apiKeys, alreadyUsedAssetKeys: usedAssetKeys });
    const preflight = postSpec.localAsset
      ? { picked: null, validated: null, failures: [] }
      : await pickFirstValidCandidate({ candidates: resolution.candidates, kind: 'photo', alreadyUsedAssetKeys: usedAssetKeys });
    let picked = preflight.picked;
    candidateFailures.push(...preflight.failures.map((failure) => ({ ...failure, targetKind: 'post', topicSlug: postSpec.topicSlug })));
    const author = accountsByHandle.get(postSpec.authorHandle);
    try {
      const result = await applyPost(db, ObjectId, { author, postSpec, picked, validatedBuffer: preflight.validated?.buffer, jwtAccessSecret, env, ordinal, now });
      if (picked) usedAssetKeys.add(candidateAssetKey(picked));
      postIdBySeedKey.set(postSpec.seedKey, result.postId);
      postResolutions.push({ spec: postSpec, resolved: true, picked, source: postSpec.localAsset ? 'generated' : picked?.provider || 'generated' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      candidateFailures.push({ targetKind: 'post', topicSlug: postSpec.topicSlug, source: picked?.provider || 'generated', reason });
      postResolutions.push({ spec: postSpec, resolved: false, picked, source: postSpec.localAsset ? 'generated' : picked?.provider || 'generated', error: reason });
    }
  }

  // 3. Reels — resolve a video, then drive the real two-step reel pipeline.
  const reelResolutions = [];
  const reelIdBySeedKey = new Map();
  for (let ordinal = 0; ordinal < plan.reels.length; ordinal += 1) {
    const reelSpec = plan.reels[ordinal];
    const topic = topicBySlug(reelSpec.topicSlug);
    const resolution = await resolveVideoCandidates({ seedKey: reelSpec.seedKey, query: reelSpec.searchQuery, topic, apiKeys, alreadyUsedAssetKeys: usedAssetKeys });
    const preflight = await pickFirstValidCandidate({ candidates: resolution.candidates, kind: 'video', alreadyUsedAssetKeys: usedAssetKeys });
    let picked = preflight.picked;
    candidateFailures.push(...preflight.failures.map((failure) => ({ ...failure, targetKind: 'reel', category: reelSpec.category, topicSlug: reelSpec.topicSlug })));
    const author = accountsByHandle.get(reelSpec.authorHandle);
    try {
      const result = await applyReel(db, ObjectId, { author, reelSpec, picked, validatedBuffer: preflight.validated?.buffer, jwtAccessSecret, env, ordinal, now, processReels });
      if (picked) usedAssetKeys.add(candidateAssetKey(picked));
      reelIdBySeedKey.set(reelSpec.seedKey, result.reelId);
      reelResolutions.push({ spec: reelSpec, resolved: true, picked, source: picked?.provider || 'generated' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      candidateFailures.push({ targetKind: 'reel', category: reelSpec.category, topicSlug: reelSpec.topicSlug, source: picked?.provider || 'generated', reason });
      if (picked) {
        try {
          const fallback = await applyReel(db, ObjectId, { author, reelSpec, picked: null, jwtAccessSecret, env, ordinal, now, processReels });
          reelIdBySeedKey.set(reelSpec.seedKey, fallback.reelId);
          reelResolutions.push({ spec: reelSpec, resolved: true, picked: null, source: 'generated' });
          continue;
        } catch (fallbackError) {
          candidateFailures.push({ targetKind: 'reel', category: reelSpec.category, topicSlug: reelSpec.topicSlug, source: 'generated', reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
        }
      }
      reelResolutions.push({ spec: reelSpec, resolved: false, picked, source: picked?.provider || 'generated', error: reason });
    }
  }

  const report = buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable: true });
  try {
    enforceMinimumInventory(report);
  } catch (error) {
    const seedRecordCount = await db.collection('beta_content_seed_records').countDocuments();
    const detail = {
      attempted: { posts: plan.posts.length, reels: plan.reels.length },
      successfullyWritten: { posts: postIdBySeedKey.size, reels: reelIdBySeedKey.size },
      failedCandidateReasons: failureSummary(candidateFailures),
      partialSeedRecordsWritten: seedRecordCount > 0,
      seedRecordCount,
      reportCommand: 'pnpm seed:beta-content --report',
      strictProductionResetCommand: 'BLABBER_SEED_TARGET=production pnpm seed:beta-content --reset --allow-production --confirm-production-beta-seed-content --confirm-reset-beta-seed-content --confirm-delete-production-beta-seed-content',
    };
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(detail, null, 2)}`);
  }

  // 4. Comments, 5. Reactions, 6. Follows — all direct, idempotent inserts.
  let commentsApplied = 0;
  for (const commentSpec of plan.comments) {
    const commenter = accountsByHandle.get(commentSpec.commenterHandle);
    const targetPostId = commentSpec.targetKind === 'post' ? postIdBySeedKey.get(commentSpec.targetSeedKey) : undefined;
    const targetReelId = commentSpec.targetKind === 'reel' ? reelIdBySeedKey.get(commentSpec.targetSeedKey) : undefined;
    if (!targetPostId && !targetReelId) continue; // that item failed to apply above — skip its comment
    await applyComment(db, ObjectId, { commentSpec, commenter, targetPostId, targetReelId, now });
    commentsApplied += 1;
  }

  let reactionsApplied = 0;
  for (const reactionSpec of plan.reactions) {
    const reactor = accountsByHandle.get(reactionSpec.reactorHandle);
    const targetPostId = reactionSpec.targetKind === 'post' ? postIdBySeedKey.get(reactionSpec.targetSeedKey) : undefined;
    const targetReelId = reactionSpec.targetKind === 'reel' ? reelIdBySeedKey.get(reactionSpec.targetSeedKey) : undefined;
    if (!targetPostId && !targetReelId) continue;
    await applyReaction(db, ObjectId, { reactionSpec, reactor, targetPostId, targetReelId, now });
    reactionsApplied += 1;
  }

  let followsApplied = 0;
  for (const followSpec of plan.follows) {
    const follower = accountsByHandle.get(followSpec.followerHandle);
    const target = accountsByHandle.get(followSpec.targetHandle);
    await applyFollow(db, ObjectId, { followSpec, follower, target, now });
    followsApplied += 1;
  }

  return {
    accounts: accountsByHandle.size,
    identityAssets: { avatars: identityAssets.filter((entry) => entry.avatar).length, covers: identityAssets.filter((entry) => entry.cover).length },
    posts: { planned: plan.posts.length, applied: postIdBySeedKey.size },
    reels: { planned: plan.reels.length, applied: reelIdBySeedKey.size },
    comments: { planned: plan.comments.length, applied: commentsApplied },
    reactions: { planned: plan.reactions.length, applied: reactionsApplied },
    follows: { planned: plan.follows.length, applied: followsApplied },
    failedCandidateReasons: failureSummary(candidateFailures),
    inventoryReport: report,
  };
}
