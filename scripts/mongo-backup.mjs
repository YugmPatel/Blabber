#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const container = process.env.BACKUP_MONGO_CONTAINER || 'blabber-full-mongodb';
const dbName = process.env.BACKUP_MONGO_DB || 'blabber_full';
const outputDir = resolve(process.env.BACKUP_DIR || 'backups/mongo');
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function runBackup() {
  await fs.mkdir(outputDir, { recursive: true });
  const archivePath = join(outputDir, `${dbName}-${stamp()}.archive.gz`);
  const out = createWriteStream(archivePath, { flags: 'wx' });
  const finishedWriting = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
  const dump = spawn('docker', ['exec', container, 'mongodump', '--quiet', '--db', dbName, '--archive', '--gzip'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  dump.stdout.pipe(out);
  let stderr = '';
  dump.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const code = await new Promise((resolve) => dump.on('close', resolve));
  await finishedWriting;
  if (code !== 0) {
    await fs.rm(archivePath, { force: true });
    throw new Error(`mongodump_failed:${code}:${stderr.slice(0, 200)}`);
  }

  const buffer = await fs.readFile(archivePath);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const stat = await fs.stat(archivePath);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: { container, database: dbName },
    archive: basename(archivePath),
    bytes: stat.size,
    sha256: checksum,
    retentionDays,
  };
  const manifestPath = `${archivePath}.manifest.json`;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await enforceRetention();
  console.log(JSON.stringify({ archivePath, manifestPath, bytes: stat.size, sha256: checksum }, null, 2));
}

async function enforceRetention() {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.archive.gz') || entry.name.endsWith('.manifest.json')))
      .map(async (entry) => {
        const path = join(outputDir, entry.name);
        const stat = await fs.stat(path);
        if (stat.mtimeMs < cutoff) await fs.rm(path, { force: true });
      })
  );
}

runBackup().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
