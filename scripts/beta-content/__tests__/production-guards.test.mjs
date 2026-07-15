import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertProductionModeAllowed,
  assertRecentMongoBackup,
  betaContentContainerCopyCommands,
  mongoBackupCommand,
  parseArgs,
  productionApplyRequirements,
  productionResetRequirements,
  productionWarningPayload,
  publicMongoTarget,
} from '../../seed-beta-content.mjs';
import { buildContentPlan } from '../content-plan.mjs';

const prodEnv = { NODE_ENV: 'production', BLABBER_SEED_TARGET: 'production' };

describe('production apply guard', () => {
  it('blocks production apply by default', () => {
    const args = parseArgs(['--apply']);
    expect(() => assertProductionModeAllowed(args, prodEnv)).toThrow(/explicit production confirmations/);
  });

  it('blocks production apply if any required flag/env is missing', () => {
    const cases = [
      { args: ['--apply', '--confirm-production-beta-seed-content'], env: prodEnv, missing: '--allow-production' },
      { args: ['--apply', '--allow-production'], env: prodEnv, missing: '--confirm-production-beta-seed-content' },
      { args: ['--apply', '--allow-production', '--confirm-production-beta-seed-content'], env: { NODE_ENV: 'production' }, missing: 'BLABBER_SEED_TARGET=production' },
    ];

    for (const entry of cases) {
      expect(() => assertProductionModeAllowed(parseArgs(entry.args), entry.env)).toThrow(entry.missing);
    }
  });

  it('allows production apply only when all apply requirements are present', () => {
    const args = parseArgs(['--apply', '--allow-production', '--confirm-production-beta-seed-content']);
    expect(productionApplyRequirements(args, prodEnv).every((item) => item.ok)).toBe(true);
    expect(assertProductionModeAllowed(args, prodEnv)).toEqual({ production: true });
  });

  it('allows production apply when all flags/env are present and recent backup evidence exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blabber-backup-ok-'));
    try {
      writeFileSync(join(dir, 'blabber_full-2026-07-15.archive.gz'), 'backup');
      const args = parseArgs(['--apply', '--allow-production', '--confirm-production-beta-seed-content']);
      expect(assertProductionModeAllowed(args, prodEnv)).toEqual({ production: true });
      expect(assertRecentMongoBackup({ dbName: 'blabber_full', backupDir: dir, now: Date.now() }).path).toContain('.archive.gz');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks production apply when backup evidence is missing and prints the backup command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blabber-backup-missing-'));
    try {
      expect(() => assertRecentMongoBackup({ dbName: 'blabber_full', backupDir: dir, now: Date.now() })).toThrow(mongoBackupCommand('blabber_full'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('production reset guard', () => {
  it('blocks production reset by default', () => {
    const args = parseArgs(['--reset']);
    expect(() => assertProductionModeAllowed(args, prodEnv)).toThrow(/--allow-production/);
  });

  it('requires the stricter reset confirmation flags', () => {
    const args = parseArgs(['--reset', '--allow-production', '--confirm-production-beta-seed-content']);
    const missing = productionResetRequirements(args, prodEnv).filter((item) => !item.ok).map((item) => item.label);
    expect(missing.join('\n')).toContain('--confirm-reset-beta-seed-content');
    expect(missing.join('\n')).toContain('--confirm-delete-production-beta-seed-content');
    expect(() => assertProductionModeAllowed(args, prodEnv)).toThrow(/--confirm-delete-production-beta-seed-content/);

    const full = parseArgs([
      '--reset',
      '--allow-production',
      '--confirm-production-beta-seed-content',
      '--confirm-reset-beta-seed-content',
      '--confirm-delete-production-beta-seed-content',
    ]);
    expect(assertProductionModeAllowed(full, prodEnv)).toEqual({ production: true });
  });
});

describe('production warning output helpers', () => {
  it('redacts Mongo credentials while preserving host and database', () => {
    expect(publicMongoTarget('mongodb://user:secret@mongo.example.com:27017/blabber_prod?authSource=admin', 'blabber_prod')).toEqual({
      hosts: 'mongo.example.com:27017',
      database: 'blabber_prod',
    });
  });

  it('prints expected counts and the destructive write warning', () => {
    const payload = productionWarningPayload({ plan: buildContentPlan(), uri: 'mongodb://user:secret@host:27017/blabber_prod', dbName: 'blabber_prod' });
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(payload.expectedCounts).toMatchObject({ accounts: 10, posts: 60, reels: 30, topics: 10, reactions: '80-150', comments: '25-40' });
    expect(payload.expectedCounts.follows).toBeGreaterThan(0);
    expect(payload.warning).toContain('media records');
  });
});

describe('container copy safety', () => {
  it('removes only temporary copied seed paths before copying fresh seed code', () => {
    const commands = betaContentContainerCopyCommands();
    expect(commands).toHaveLength(3);

    const [cleanupCommand, scriptCopyCommand, dirCopyCommand] = commands;
    expect(cleanupCommand[0]).toBe('docker');
    expect(cleanupCommand[1]).toEqual([
      'compose', '-f', 'docker-compose.full.yml', 'exec', '-T',
      'media', 'sh', '-lc',
      'rm -rf -- /app/services/media/seed-beta-content.mjs /app/services/media/beta-content',
    ]);
    expect(cleanupCommand[1].join(' ')).not.toContain('/data/blabber-media');

    expect(scriptCopyCommand).toEqual(['docker', ['compose', '-f', 'docker-compose.full.yml', 'cp', 'scripts/seed-beta-content.mjs', 'media:/app/services/media/seed-beta-content.mjs']]);
    expect(dirCopyCommand).toEqual(['docker', ['compose', '-f', 'docker-compose.full.yml', 'cp', 'scripts/beta-content/.', 'media:/app/services/media/beta-content']]);
  });
});
