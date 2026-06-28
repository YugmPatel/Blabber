#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const archivePath = args.get('--archive') ? resolve(args.get('--archive')) : null;
const targetDb = args.get('--target-db') || process.env.RESTORE_TARGET_DB;
const sourceDb = args.get('--source-db') || process.env.BACKUP_MONGO_DB || 'blabber_full';
const container = process.env.BACKUP_MONGO_CONTAINER || 'blabber-full-mongodb';
const confirmed = process.argv.includes('--confirm-non-prod-restore');

function assertSafeTarget() {
  if (!archivePath || !targetDb || !confirmed) {
    throw new Error('Usage: pnpm backup:restore -- --archive <file.archive.gz> --target-db <non-prod-db> --confirm-non-prod-restore');
  }
  if (targetDb === sourceDb || !/(test|staging|restore|verify|tmp|dev)/i.test(targetDb)) {
    throw new Error('Refusing restore: target DB must be explicit non-production and different from source');
  }
}

async function verifyChecksum() {
  const manifestPath = `${archivePath}.manifest.json`;
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const checksum = createHash('sha256').update(await fs.readFile(archivePath)).digest('hex');
  if (checksum !== manifest.sha256) throw new Error('Backup checksum verification failed');
  return manifest;
}

async function restore() {
  assertSafeTarget();
  const manifest = await verifyChecksum();
  const input = await fs.open(archivePath, 'r');
  const restore = spawn(
    'docker',
    [
      'exec',
      '-i',
      container,
      'mongorestore',
      '--quiet',
      '--archive',
      '--gzip',
      '--drop',
      `--nsFrom=${sourceDb}.*`,
      `--nsTo=${targetDb}.*`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  input.createReadStream().pipe(restore.stdin);
  let stderr = '';
  restore.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  const code = await new Promise((resolve) => restore.on('close', resolve));
  await input.close();
  if (code !== 0) throw new Error(`mongorestore_failed:${code}:${stderr.slice(0, 200)}`);
  console.log(JSON.stringify({ restored: true, sourceDb, targetDb, archive: manifest.archive, sha256: manifest.sha256 }, null, 2));
}

restore().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
