// Minimum-inventory enforcement and current-state reporting. The core rule
// from the task: the seed run must never silently leave beta content short
// of its targets — either the plan/resolution phase catches a shortfall
// before writing anything, or --apply fails loudly with a specific message
// once it's clear a category came up short, matching the task's example:
// "ERROR: Required 30 reels, only 24 valid reels selected. Missing
// categories: campus, food."

import { spawnSync } from 'node:child_process';
import { REEL_CATEGORY_TARGETS, REQUIRED_INVENTORY } from './config.mjs';

export function checkFfmpegAvailable() {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  return result.status === 0;
}

/**
 * Pure summarization of a resolution pass (dry-run or apply) into counts per
 * reel category and topic, plus a `problems` list describing exactly what's
 * short. `reelResolutions`/`postResolutions` are arrays of
 * `{ spec, resolved: boolean }` — `resolved` means either a real external
 * candidate was found or a local-generated fallback is available (the
 * caller decides which, this module only aggregates).
 */
export function buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable }) {
  const problems = [];

  if (plan.accounts.length < REQUIRED_INVENTORY.demoAccounts) {
    problems.push(`Required ${REQUIRED_INVENTORY.demoAccounts} demo accounts, plan only has ${plan.accounts.length}.`);
  }
  if (plan.topics.length < REQUIRED_INVENTORY.discoverTopics) {
    problems.push(`Required ${REQUIRED_INVENTORY.discoverTopics} Discover topics, plan only has ${plan.topics.length}.`);
  }

  const resolvedPostCount = postResolutions.filter((entry) => entry.resolved).length;
  if (resolvedPostCount < REQUIRED_INVENTORY.feedPosts) {
    problems.push(`Required ${REQUIRED_INVENTORY.feedPosts} feed posts, only ${resolvedPostCount} valid posts resolved.`);
  }

  const resolvedReelCount = reelResolutions.filter((entry) => entry.resolved).length;
  const categoryCounts = {};
  const categoryResolvedCounts = {};
  for (const entry of reelResolutions) {
    const category = entry.spec.category;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    if (entry.resolved) categoryResolvedCounts[category] = (categoryResolvedCounts[category] || 0) + 1;
  }
  const missingCategories = Object.keys(REEL_CATEGORY_TARGETS).filter(
    (category) => (categoryResolvedCounts[category] || 0) < REEL_CATEGORY_TARGETS[category]
  );
  if (resolvedReelCount < REQUIRED_INVENTORY.reels) {
    problems.push(
      `Required ${REQUIRED_INVENTORY.reels} reels, only ${resolvedReelCount} valid reels selected.` +
        (missingCategories.length > 0 ? ` Missing categories: ${missingCategories.join(', ')}.` : '')
    );
  }

  const needsLocalFallback =
    postResolutions.some((entry) => entry.resolved && !entry.picked) || reelResolutions.some((entry) => entry.resolved && !entry.picked);
  if (needsLocalFallback && !ffmpegAvailable) {
    problems.push('ffmpeg is not available, and at least one post/reel has no valid external candidate — the local Blabber-branded fallback asset generator cannot run, so that shortfall cannot be covered.');
  }

  const sourceMix = {};
  for (const entry of [...postResolutions, ...reelResolutions]) {
    if (!entry.resolved) continue;
    const source = entry.source || entry.picked?.provider || 'generated';
    sourceMix[source] = (sourceMix[source] || 0) + 1;
  }

  return {
    accounts: plan.accounts.length,
    topics: plan.topics.length,
    posts: { planned: plan.posts.length, resolved: resolvedPostCount },
    reels: { planned: plan.reels.length, resolved: resolvedReelCount, byCategory: categoryResolvedCounts, missingCategories },
    comments: plan.comments.length,
    reactions: plan.reactions.length,
    follows: plan.follows.length,
    sourceMix,
    problems,
    ok: problems.length === 0,
  };
}

/** Throws with the exact clear-error format the task specifies if the report has any problems. */
export function enforceMinimumInventory(report) {
  if (report.ok) return;
  throw new Error(['ERROR: Minimum beta content inventory was not met.', ...report.problems.map((problem) => `  - ${problem}`)].join('\n'));
}

/**
 * Queries current seeded-content counts from the beta_content_seed_records
 * tracking collection (written by db-writer.mjs's recordSeedTracking on
 * every apply) — used by --report and to decide what --reset should remove.
 */
export async function countCurrentInventory(db) {
  const counts = await db
    .collection('beta_content_seed_records')
    .aggregate([{ $group: { _id: '$kind', count: { $sum: 1 } } }])
    .toArray();
  const byKind = Object.fromEntries(counts.map((row) => [row._id, row.count]));
  const sourceCounts = await db
    .collection('beta_content_seed_records')
    .aggregate([{ $group: { _id: '$source.source', count: { $sum: 1 } } }])
    .toArray();
  return {
    byKind,
    sourceMix: Object.fromEntries(sourceCounts.map((row) => [row._id || 'unknown', row.count])),
    total: counts.reduce((sum, row) => sum + row.count, 0),
  };
}
