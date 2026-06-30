#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const files = [];

function walk(dir) {
  for (const item of readdirSync(dir)) {
    const path = join(dir, item);
    const stat = statSync(path);
    if (stat.isDirectory() && !['node_modules', 'dist', '.expo'].includes(item)) walk(path);
    if (stat.isFile() && /\.(ts|tsx|js)$/.test(item)) files.push(path);
  }
}

walk(root);

const all = files.map((file) => [file, readFileSync(file, 'utf8')]);
for (const [file, text] of all) {
  assert(!/AsyncStorage/.test(text), `${file} must not use AsyncStorage`);
  assert(!/WebView/.test(text), `${file} must not use WebView`);
  assert(!/Analytics|Firebase|Crashlytics|Sentry/.test(text), `${file} must not add analytics/tracking SDKs`);
  assert(!/console\.log/.test(text), `${file} must not console.log sensitive mobile data`);
  assert(!/query:\s*\{[^}]*token/i.test(text), `${file} must not put token in Socket.IO query params`);
}

console.log(`mobile lint passed (${files.length} files checked)`);
