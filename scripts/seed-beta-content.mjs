#!/usr/bin/env node
// Beta content population system — CLI entrypoint.
//
//   pnpm seed:beta-content --dry-run
//   pnpm seed:beta-content --apply
//   pnpm seed:beta-content --report
//   pnpm seed:beta-content --reset --confirm-reset-beta-seed-content
//
// See scripts/beta-content/README.md for full documentation. Modeled
// directly on the proven patterns in scripts/import-pexels-demo-content.mjs
// and scripts/seed-demo-social.mjs — --apply/--report/--reset re-exec this
// script inside the `media` Docker container (for Mongo/LOCAL_MEDIA_DIR/
// localhost-service access), while --dry-run runs entirely on the host
// (provider API calls only, no database or container dependency).

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { requireProviderKeys, mediaServicePort, mongoUri, mongoDbName } from './beta-content/config.mjs';
import { buildContentPlan } from './beta-content/content-plan.mjs';
import { resolvePhoto, resolveVideo } from './beta-content/resolve-asset.mjs';
import { candidateAssetKey } from './beta-content/asset-score.mjs';
import { buildInventoryReport, checkFfmpegAvailable, countCurrentInventory, enforceMinimumInventory } from './beta-content/inventory.mjs';
import { topicBySlug } from './beta-content/topics.mjs';

const MODE_FLAGS = ['--dry-run', '--apply', '--report', '--reset'];

export function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const modes = MODE_FLAGS.filter((flag) => flags.has(flag));
  if (modes.length !== 1) {
    throw new Error(`Exactly one mode flag is required: ${MODE_FLAGS.join(' | ')}`);
  }
  return {
    mode: modes[0].slice(2),
    allowProduction: flags.has('--allow-production'),
    confirmProduction: flags.has('--confirm-production-beta-seed-content'),
    confirmReset: flags.has('--confirm-reset-beta-seed-content'),
    confirmDeleteProduction: flags.has('--confirm-delete-production-beta-seed-content'),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

export function isProductionLike(env) {
  const prodValues = [env.NODE_ENV, env.APP_ENV, env.BLABBER_ENV].filter(Boolean).map((value) => String(value).toLowerCase());
  return prodValues.some((value) => value === 'production' || value.includes('prod')) || env.BLABBER_SEED_TARGET === 'production';
}

export function productionApplyRequirements(args, env) {
  return [
    { ok: args.mode === 'apply', label: 'CLI mode must be --apply' },
    { ok: Boolean(args.allowProduction), label: 'CLI flag --allow-production is required' },
    { ok: Boolean(args.confirmProduction), label: 'CLI flag --confirm-production-beta-seed-content is required' },
    { ok: env.BLABBER_SEED_TARGET === 'production', label: 'BLABBER_SEED_TARGET=production is required' },
  ];
}

export function productionResetRequirements(args, env) {
  return [
    { ok: args.mode === 'reset', label: 'CLI mode must be --reset' },
    { ok: Boolean(args.allowProduction), label: 'CLI flag --allow-production is required' },
    { ok: Boolean(args.confirmProduction), label: 'CLI flag --confirm-production-beta-seed-content is required' },
    { ok: Boolean(args.confirmReset), label: 'CLI flag --confirm-reset-beta-seed-content is required' },
    { ok: Boolean(args.confirmDeleteProduction), label: 'CLI flag --confirm-delete-production-beta-seed-content is required' },
    { ok: env.BLABBER_SEED_TARGET === 'production', label: 'BLABBER_SEED_TARGET=production is required' },
  ];
}

function formatMissingRequirements(requirements) {
  return requirements.filter((item) => !item.ok).map((item) => `  - ${item.label}`).join('\n');
}

export function assertProductionModeAllowed(args, env) {
  if (!isProductionLike(env)) return { production: false };
  const requirements = args.mode === 'reset' ? productionResetRequirements(args, env) : productionApplyRequirements(args, env);
  const missing = requirements.filter((item) => !item.ok);
  if (missing.length > 0) {
    throw new Error(
      [
        'Refusing to run the beta content seed system in a production-like environment without explicit production confirmations.',
        'Missing requirements:',
        formatMissingRequirements(requirements),
      ].join('\n')
    );
  }
  return { production: true };
}

export function assertNotProductionLike(env) {
  const prodValues = [env.NODE_ENV, env.APP_ENV, env.BLABBER_ENV].filter(Boolean).map((value) => String(value).toLowerCase());
  if (prodValues.some((value) => value === 'production' || value.includes('prod'))) {
    throw new Error('Refusing to run the beta content seed system in a production-like environment (NODE_ENV/APP_ENV/BLABBER_ENV looked like production).');
  }
}

export function publicMongoTarget(uri, dbName) {
  try {
    const parsed = new URL(uri);
    const hosts = parsed.host || '(unknown host)';
    const pathDb = parsed.pathname.replace(/^\/+/, '').split('/')[0];
    return { hosts, database: dbName || pathDb || '(default database)' };
  } catch {
    const withoutCredentials = String(uri).replace(/\/\/([^/@]+)@/, '//');
    return { hosts: withoutCredentials, database: dbName || '(unknown database)' };
  }
}

export function mongoBackupCommand(dbName) {
  return `BACKUP_MONGO_DB=${dbName} pnpm backup:mongo`;
}

export function findRecentMongoBackup({ backupDir = process.env.BLABBER_MONGO_BACKUP_DIR || 'backups/mongo', now = Date.now(), maxAgeHours = 24 } = {}) {
  if (process.env.BLABBER_MONGO_BACKUP_EVIDENCE) {
    return { path: process.env.BLABBER_MONGO_BACKUP_EVIDENCE, mtimeMs: now, size: 1, preverified: true };
  }
  const absoluteDir = resolve(process.cwd(), backupDir);
  if (!existsSync(absoluteDir)) return null;
  const cutoff = now - maxAgeHours * 60 * 60 * 1000;
  const candidates = readdirSync(absoluteDir)
    .filter((name) => name.endsWith('.archive.gz') || name.endsWith('.archive.gz.manifest.json') || name.endsWith('.manifest.json'))
    .map((name) => {
      const path = resolve(absoluteDir, name);
      const stat = statSync(path);
      return { path, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .filter((entry) => entry.size > 0 && entry.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

export function assertRecentMongoBackup({ dbName, backupDir, now } = {}) {
  const backup = findRecentMongoBackup({ backupDir, now });
  if (backup) return backup;
  throw new Error(
    [
      'Refusing production beta content apply: no recent Mongo backup evidence was found in backups/mongo.',
      `Run this backup command first, verify it succeeds, then re-run the seed command: ${mongoBackupCommand(dbName)}`,
    ].join('\n')
  );
}

export function productionWarningPayload({ plan, uri, dbName }) {
  const target = publicMongoTarget(uri, dbName);
  return {
    targetDatabaseName: target.database,
    mongoTarget: target,
    expectedCounts: {
      accounts: plan.accounts.length,
      posts: plan.posts.length,
      reels: plan.reels.length,
      topics: plan.topics.length,
      reactions: `${REQUIRED_REACTION_RANGE}`,
      comments: `${REQUIRED_COMMENT_RANGE}`,
      follows: plan.follows.length,
    },
    warning: 'This will create beta seed users, posts, reels, media records, reactions, comments, and follows in the target database.',
  };
}

const REQUIRED_REACTION_RANGE = '80-150';
const REQUIRED_COMMENT_RANGE = '25-40';

// ---------------------------------------------------------------------------
// --dry-run: host-side only, real provider network calls, zero DB access.
// ---------------------------------------------------------------------------

async function runDryRun() {
  dotenv.config({ quiet: true });
  requireProviderKeys(['pexels', 'pixabay', 'unsplash']);
  const apiKeys = { pexels: process.env.PEXELS_API_KEY, pixabay: process.env.PIXABAY_API_KEY, unsplash: process.env.UNSPLASH_ACCESS_KEY };

  const plan = buildContentPlan();
  const usedAssetKeys = new Set();
  const providerCounts = {};

  console.log(`Resolving ${plan.posts.length} post photo candidates against Pexels/Pixabay/Unsplash...`);
  const postResolutions = [];
  for (const postSpec of plan.posts) {
    const topic = topicBySlug(postSpec.topicSlug);
    const { picked, attempts } = postSpec.localAsset
      ? { picked: null, attempts: [{ provider: 'generated', skipped: true, reason: 'seed-owned branded card' }] }
      : await resolvePhoto({ seedKey: postSpec.seedKey, query: postSpec.searchQuery, topic, apiKeys, alreadyUsedAssetKeys: usedAssetKeys });
    if (picked) {
      usedAssetKeys.add(candidateAssetKey(picked));
      providerCounts[picked.provider] = (providerCounts[picked.provider] || 0) + 1;
    } else if (postSpec.localAsset) {
      providerCounts.generated = (providerCounts.generated || 0) + 1;
    }
    // A resolvable local fallback always exists in dry-run's accounting
    // (ffmpeg availability is checked separately below) — only a genuinely
    // impossible ffmpeg situation would make this "unresolved".
    postResolutions.push({ spec: postSpec, resolved: true, picked, source: postSpec.localAsset ? 'generated' : picked?.provider || 'generated', attempts });
  }

  console.log(`Resolving ${plan.reels.length} reel video candidates against Pexels/Pixabay...`);
  const reelResolutions = [];
  for (const reelSpec of plan.reels) {
    const topic = topicBySlug(reelSpec.topicSlug);
    const { picked, attempts } = await resolveVideo({ seedKey: reelSpec.seedKey, query: reelSpec.searchQuery, topic, apiKeys, alreadyUsedAssetKeys: usedAssetKeys });
    if (picked) {
      usedAssetKeys.add(candidateAssetKey(picked));
      providerCounts[picked.provider] = (providerCounts[picked.provider] || 0) + 1;
    }
    reelResolutions.push({ spec: reelSpec, resolved: true, picked, source: picked?.provider || 'generated', attempts });
  }

  const ffmpegAvailable = checkFfmpegAvailable();
  const report = buildInventoryReport({ plan, postResolutions, reelResolutions, ffmpegAvailable });
  const localFallbackCount = { posts: postResolutions.filter((r) => !r.picked).length, reels: reelResolutions.filter((r) => !r.picked).length };

  console.log(JSON.stringify(
    {
      mode: 'dry-run',
      inventory: report,
      sourceMix: report.sourceMix,
      localFallback: localFallbackCount,
      ffmpegAvailable,
      note: 'No database writes were made. Run --apply to create this content for real.',
    },
    null,
    2
  ));

  enforceMinimumInventory(report);
  console.log('\nDry-run inventory check: PASS — minimum beta content targets are reachable.');
}

// ---------------------------------------------------------------------------
// --apply / --report / --reset: run inside the media Docker container.
// ---------------------------------------------------------------------------

async function runInsideContainer(args) {
  const { mode, confirmReset } = args;
  const productionGuard = assertProductionModeAllowed(args, process.env);
  const { MongoClient, ObjectId } = await import('mongodb');
  const mongo = new MongoClient(mongoUri(process.env));
  await mongo.connect();
  const db = mongo.db(mongoDbName(process.env));

  try {
    if (mode === 'report') {
      const inventory = await countCurrentInventory(db);
      console.log(JSON.stringify({ mode: 'report', inventory }, null, 2));
      return;
    }

    if (mode === 'reset') {
      if (!confirmReset) {
        throw new Error('Refusing to reset beta content without --confirm-reset-beta-seed-content. Re-run with both --reset --confirm-reset-beta-seed-content.');
      }
      const { resetBetaContent } = await import('./beta-content/reset.mjs');
      const result = await resetBetaContent(db);
      console.log(JSON.stringify({ mode: 'reset', result }, null, 2));
      return;
    }

    if (mode === 'apply') {
      requireProviderKeys(['pexels', 'pixabay', 'unsplash']);
      const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
      if (!jwtAccessSecret) throw new Error('JWT_ACCESS_SECRET is required to run --apply (needed to authenticate against the media service).');

      const { applyContentPlan } = await import('./beta-content/apply.mjs');
      if (productionGuard.production) {
        const plan = buildContentPlan();
        console.log(JSON.stringify(productionWarningPayload({ plan, uri: mongoUri(process.env), dbName: mongoDbName(process.env) }), null, 2));
        const backup = assertRecentMongoBackup({ dbName: mongoDbName(process.env), backupDir: process.env.BLABBER_MONGO_BACKUP_DIR });
        console.log(JSON.stringify({ productionBackupEvidence: backup }, null, 2));
      }
      const result = await applyContentPlan(db, ObjectId, {
        env: process.env,
        jwtAccessSecret,
        port: mediaServicePort(process.env),
      });
      console.log(JSON.stringify({ mode: 'apply', result }, null, 2));
      return;
    }

    throw new Error(`Unsupported in-container mode: ${mode}`);
  } finally {
    await mongo.close();
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { mode, confirmReset, allowProduction, confirmProduction, confirmDeleteProduction } = args;

  if (mode === 'dry-run') {
    await runDryRun();
  } else if (process.env.BLABBER_BETA_CONTENT_IN_CONTAINER !== '1') {
    dotenv.config({ quiet: true });
    const productionGuard = assertProductionModeAllowed(args, process.env);
    if (productionGuard.production && mode === 'apply') {
      const backup = assertRecentMongoBackup({ dbName: mongoDbName(process.env), backupDir: process.env.BLABBER_MONGO_BACKUP_DIR });
      process.env.BLABBER_MONGO_BACKUP_EVIDENCE = backup.path;
    }
    const flagArgs = [
      `--${mode}`,
      ...(allowProduction ? ['--allow-production'] : []),
      ...(confirmProduction ? ['--confirm-production-beta-seed-content'] : []),
      ...(confirmReset ? ['--confirm-reset-beta-seed-content'] : []),
      ...(confirmDeleteProduction ? ['--confirm-delete-production-beta-seed-content'] : []),
    ];
    run('docker', ['compose', '-f', 'docker-compose.full.yml', 'cp', 'scripts/seed-beta-content.mjs', 'media:/app/services/media/seed-beta-content.mjs']);
    run('docker', ['compose', '-f', 'docker-compose.full.yml', 'cp', 'scripts/beta-content', 'media:/app/services/media/beta-content']);
    run('docker', [
      'compose', '-f', 'docker-compose.full.yml', 'exec', '-T',
      '-e', 'BLABBER_BETA_CONTENT_IN_CONTAINER=1',
      '-e', 'NODE_ENV=development', '-e', 'APP_ENV=development',
      '-e', 'BLABBER_SEED_TARGET',
      '-e', 'BLABBER_MONGO_BACKUP_DIR',
      '-e', 'BLABBER_MONGO_BACKUP_EVIDENCE',
      '-e', 'PEXELS_API_KEY', '-e', 'PIXABAY_API_KEY', '-e', 'UNSPLASH_ACCESS_KEY',
      'media', 'node', '/app/services/media/seed-beta-content.mjs', ...flagArgs,
    ], { env: { ...process.env } });
  } else {
    await runInsideContainer(args);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
