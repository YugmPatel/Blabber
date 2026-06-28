#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const container = process.env.BACKUP_MONGO_CONTAINER || 'blabber-full-mongodb';
const sourceDb = process.env.BACKUP_MONGO_DB || 'blabber_full';
const verifyDb = `blabber_restore_verify_${Date.now()}`;
const backupDir = process.env.BACKUP_DIR || 'backups/mongo';

function dockerExec(args) {
  return execFileSync('docker', ['exec', container, ...args], { encoding: 'utf8' });
}

async function latestArchive() {
  const entries = await fs.readdir(backupDir);
  const archives = entries.filter((name) => name.endsWith('.archive.gz')).sort();
  if (!archives.length) throw new Error('No backup archive produced');
  return join(backupDir, archives[archives.length - 1]);
}

async function main() {
  dockerExec(['mongosh', '--quiet', sourceDb, '--eval', "db.backup_restore_smoke.updateOne({_id:'sentinel'}, {$set:{value:'ok', updatedAt:new Date()}}, {upsert:true})"]);
  execFileSync('node', ['scripts/mongo-backup.mjs'], { stdio: 'inherit', env: process.env });
  const archive = await latestArchive();
  execFileSync(
    'node',
    ['scripts/mongo-restore.mjs', '--archive', archive, '--target-db', verifyDb, '--confirm-non-prod-restore'],
    { stdio: 'inherit', env: process.env }
  );
  const result = dockerExec(['mongosh', '--quiet', verifyDb, '--eval', "db.backup_restore_smoke.findOne({_id:'sentinel'}).value"]);
  if (!result.includes('ok')) throw new Error('Restore verification did not find sentinel document');
  dockerExec(['mongosh', '--quiet', '--eval', `db.getSiblingDB('${verifyDb}').dropDatabase()`]);
  console.log(JSON.stringify({ backupRestoreVerified: true, sourceDb, verifyDb, archive }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
