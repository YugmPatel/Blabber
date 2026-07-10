#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const pnpmStore = join(root, 'node_modules', '.pnpm');
const mongodbPackage = existsSync(pnpmStore)
  ? readdirSync(pnpmStore).find((name) => name.startsWith('mongodb@') && !name.includes('mongodb-connection-string-url'))
  : null;
if (!mongodbPackage) throw new Error('mongodb package not found in workspace pnpm store');
const { MongoClient, ObjectId } = require(join(pnpmStore, mongodbPackage, 'node_modules', 'mongodb'));

const gateway = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const servicePorts = { auth: 3001, users: 3002, chats: 3003, messages: 3004, media: 3005, notifications: 3006 };
const runId = `release-g-hardening-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = { cleanup: [] };
const concurrency = Math.max(1, Math.min(8, Number(process.env.RELEASE_G_HARDENING_CONCURRENCY || 4)));

function test(name, fn) { tests.push({ name, fn }); }
function read(path) { return readFileSync(join(root, path), 'utf8'); }
function exists(path) { return existsSync(join(root, path)); }
function files(dir, out = []) {
  for (const entry of readdirSync(join(root, dir))) {
    const full = join(root, dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && !['node_modules', 'dist', '.turbo', '.expo'].includes(entry)) files(join(dir, entry), out);
    if (stat.isFile()) out.push(full);
  }
  return out;
}
function source(path) { return read(path); }
function safePath(path) {
  return path
    .replace(/[A-Za-z0-9_-]{24,}/g, ':token')
    .replace(/[a-f0-9]{24}/gi, ':id')
    .replace(/token=[^&\s]+/g, 'token=:token');
}
async function api(method, path, { token, body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${gateway}${path}`, {
    method,
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const message = typeof data?.message === 'string' ? data.message : 'unexpected response';
    throw new Error(`${method} ${safePath(path)} returned ${response.status}: ${message}`);
  }
  return { status: response.status, data, headers: response.headers };
}
async function firstOk(urls, path) {
  let lastError;
  for (const base of urls) {
    try {
      const response = await fetch(`${base}${path}`, { method: 'GET' });
      if (response.ok) return response.json();
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('service unavailable');
}
function serviceUrls(name) {
  const explicit = process.env[`SMOKE_${name.toUpperCase()}_URL`];
  return explicit ? [explicit.replace(/\/+$/, '')] : [`http://${name}:${servicePorts[name]}`, `http://localhost:${servicePorts[name]}`];
}
async function register(label) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 30);
  const response = await api('POST', '/api/auth/register', {
    expected: 201,
    body: {
      username: `rgh_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-g-hardening-${unique}@example.com`,
      password: `Pass-${unique}-42`,
      name: 'Release G Hardening',
    },
  });
  assert(response.data.accessToken);
  assert(response.data.user?._id || response.data.user?.id);
  return { token: response.data.accessToken, user: response.data.user };
}
async function connectDb() {
  if (state.db) return state.db;
  const uriCandidates = [
    process.env.SMOKE_MONGO_URI || process.env.MONGO_URI || 'mongodb://mongodb:27017',
    'mongodb://localhost:27017',
    'mongodb://localhost:27018',
  ];
  let lastError;
  for (const uri of uriCandidates) {
    try {
      state.mongo = new MongoClient(uri);
      await state.mongo.connect();
      state.db = state.mongo.db(process.env.SMOKE_MONGO_DB_NAME || process.env.MONGO_DB_NAME || 'blabber_full');
      return state.db;
    } catch (error) {
      lastError = error;
      if (state.mongo) await state.mongo.close().catch(() => undefined);
    }
  }
  throw lastError || new Error('mongo unavailable');
}
async function cleanup() {
  for (const item of state.cleanup.reverse()) await item().catch(() => undefined);
  if (state.mongo) await state.mongo.close().catch(() => undefined);
}

test('01 gateway health returns non-sensitive ok status', async () => {
  const response = await api('GET', '/healthz');
  assert.equal(response.data.status, 'ok');
  assert(!JSON.stringify(response.data).includes('mongodb://'));
});
test('02 gateway readiness returns non-sensitive ready status', async () => {
  const response = await api('GET', '/readyz');
  assert.equal(response.data.status, 'ready');
  assert(Array.isArray(response.data.checks));
});
for (const name of Object.keys(servicePorts)) {
  test(`service health is ok for ${name}`, async () => {
    const data = await firstOk(serviceUrls(name), '/healthz');
    assert.equal(data.status, 'ok');
    assert.equal(data.service, name);
  });
  test(`service readiness is safe for ${name}`, async () => {
    const data = await firstOk(serviceUrls(name), '/readyz');
    assert(['ready', 'not_ready'].includes(data.status));
    assert(Array.isArray(data.checks));
    assert(!JSON.stringify(data).includes('mongodb://'));
  });
}

test('15 valid local CORS origin is allowed without exposing headers', async () => {
  const response = await fetch(`${gateway}/healthz`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});
test('16 disallowed CORS origin is not reflected', async () => {
  const response = await fetch(`${gateway}/healthz`, { headers: { origin: 'https://invalid.example' } });
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://invalid.example');
});
test('17 CORS config rejects wildcard with credentials in source', () => {
  const text = source('packages/config/src/cors.ts');
  assert(text.includes("origins.includes('*')"));
  assert(text.includes('wildcard origins cannot be used with credentials'));
});
test('18 valid explicit CORS allowlist parser is preserved in source', () => {
  const text = source('packages/config/src/cors.ts');
  assert(text.includes('ALLOWED_ORIGINS'));
  assert(text.includes('split'));
  assert(text.includes('credentials'));
});

test('19 hardening smoke command is tracked', () => {
  assert(JSON.parse(read('package.json')).scripts['smoke:release-g-hardening']);
});
for (const doc of [
  'docs/security-hardening.md',
  'docs/performance-scale.md',
  'docs/operations-runbook.md',
  'docs/backup-restore-drill.md',
  'docs/release-g-hardening.md',
]) {
  test(`required hardening doc exists: ${doc}`, () => {
    assert(exists(doc));
    assert(read(doc).length > 500);
  });
}

test('25 structured body limit is centralized', () => {
  const text = source('packages/config/src/request-body.ts');
  assert(text.includes('STRUCTURED_BODY_LIMIT'));
  assert(text.includes('256kb'));
});
for (const path of [
  'apps/gateway/src/app.ts',
  'services/auth/src/app.ts',
  'services/users/src/app.ts',
  'services/chats/src/app.ts',
  'services/messages/src/app.ts',
  'services/media/src/app.ts',
  'services/notifications/src/app.ts',
]) {
  test(`structured parser options are wired in ${path}`, () => {
    const text = source(path);
    assert(text.includes('structuredJsonParserOptions'));
    if (!path.includes('gateway')) assert(text.includes('structuredUrlEncodedParserOptions'));
  });
}
test('33 raw media upload limits remain larger than structured bodies', () => {
  const text = source('services/media/src/app.ts');
  assert(text.includes("limit: '50mb'"));
  assert(text.includes("limit: '110mb'"));
});
test('34 oversized JSON returns a safe normalized error', async () => {
  const response = await fetch(`${gateway}/api/reels/upload-init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: 'x'.repeat(300 * 1024) }),
  });
  assert.equal(response.status, 413);
  const text = await response.text();
  assert(!text.includes('256kb'));
});
test('35 oversized urlencoded returns a safe normalized error', async () => {
  const response = await fetch(`${gateway}/api/reels/upload-init`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `payload=${'x'.repeat(300 * 1024)}`,
  });
  assert([401, 413, 415].includes(response.status));
});

for (const field of [
  'storageKey', 'localPath', 'uploadUrl', 'manifestUrl', 'segmentUrl', 'fallbackUrl', 'posterUrl',
  'caption', 'comment.body', 'sessionToken', 'eventToken', 'candidateToken', 'score', 'affinity',
  'pushToken', 'verificationChallenge', 'providerReceipt', 'deviceId', 'reportEvidence', 'req.headers.cookie',
]) {
  test(`logger redacts ${field}`, () => {
    assert(source('packages/utils/src/logger.ts').includes(field));
  });
}
test('56 logger preserves request correlation fields', () => {
  const text = source('packages/utils/src/http.ts');
  assert(text.includes('requestId'));
  assert(text.includes('service'));
  assert(text.includes('statusCode'));
});

test('57 Reel processor has stale recovery query and lease fencing', () => {
  const text = source('services/media/src/reel-processing.ts');
  assert(text.includes('REEL_STALE_PROCESSING_MS'));
  assert(text.includes('processingLeaseId'));
  assert(text.includes("processingStatus: { $in: ['validating', 'processing'] }"));
});
test('58 Reel processor avoids deleted/cancelled stale revival', () => {
  const text = source('services/media/src/reel-processing.ts');
  assert(text.includes("publishState: { $ne: 'deleted' }"));
  assert(text.includes("deletedAt: { $exists: false }"));
});
test('59 Reel index supports stale recovery scan', () => {
  assert(source('services/media/src/models/reel.ts').includes('processingStartedAt'));
});

test('60 notification delivery remains bounded and fake-provider isolated', () => {
  const send = source('services/notifications/src/routes/send.ts');
  const provider = source('services/notifications/src/mobile-push-provider.ts');
  assert(send.includes('limit(10)'));
  assert(provider.includes('fake'));
  assert(provider.includes('invalid_token'));
});
test('61 ops push diagnostics remain token-gated', () => {
  const text = source('services/notifications/src/app.ts');
  assert(text.includes('/ops/push'));
  assert(text.includes('x-ops-token'));
});

test('62 backup scripts prevent active database overwrite', () => {
  const restore = source('scripts/mongo-restore.mjs');
  assert(restore.includes('--confirm-non-prod-restore'));
  assert(restore.includes('targetDb === sourceDb'));
  assert(restore.includes('Refusing restore'));
});
test('63 backup verify uses an isolated restore target and cleanup', () => {
  const verify = source('scripts/mongo-backup-verify.mjs');
  assert(verify.includes('blabber_restore_verify_'));
  assert(verify.includes('dropDatabase'));
});
test('64 backup restore drill uses isolated generated fixture metadata', async () => {
  const db = await connectDb();
  const sourceName = `backup_restore_smoke_source_${runId.replace(/[^a-z0-9_]/gi, '_')}`;
  const targetName = `backup_restore_smoke_target_${runId.replace(/[^a-z0-9_]/gi, '_')}`;
  const sourceCollection = db.collection(sourceName);
  const targetCollection = db.collection(targetName);
  state.cleanup.push(() => sourceCollection.drop());
  state.cleanup.push(() => targetCollection.drop());
  await sourceCollection.insertOne({ _id: new ObjectId(), fixtureType: 'release-g-hardening', schemaVersion: 1 });
  const docs = await sourceCollection.find({}, { projection: { fixtureType: 1, schemaVersion: 1 } }).toArray();
  await targetCollection.insertMany(docs);
  assert.equal(await targetCollection.countDocuments({ fixtureType: 'release-g-hardening', schemaVersion: 1 }), 1);
});

test('65 auth refresh query is bounded to active sessions for one user', () => {
  const refresh = source('services/auth/src/routes/refresh.ts');
  const session = source('services/auth/src/models/device-session.ts');
  assert(refresh.includes('new ObjectId(payload.userId)'));
  assert(refresh.includes('find({ userId, revokedAt'));
  assert(refresh.includes('revokedAt: { $exists: false }'));
  assert(refresh.includes('compareRefreshToken'));
  assert(session.includes('bcrypt.compare'));
});
test('66 session model has user and expiry indexes', () => {
  const text = source('services/auth/src/models/device-session.ts');
  assert(text.includes('userId'));
  assert(text.includes('expiresAt'));
});

test('67 throwaway user registration works without printing credentials', async () => {
  state.client = await register('primary');
});
test('68 authenticated account endpoint works for throwaway user', async () => {
  const response = await api('GET', '/api/auth/me', { token: state.client.token });
  assert(response.data.user);
});
test('69 unauthorized private endpoint stays denied', async () => {
  await api('GET', '/api/auth/me', { expected: 401 });
});
test('70 bounded concurrent reads have no unexpected 5xx', async () => {
  const tasks = Array.from({ length: concurrency * 3 }, () => api('GET', '/api/auth/me', { token: state.client.token, expected: [200, 429] }));
  const responses = await Promise.all(tasks);
  assert(responses.every((item) => item.status < 500));
});
test('71 bounded safe mutations have no unexpected 5xx', async () => {
  const tasks = Array.from({ length: concurrency }, (_, index) => api('PATCH', '/api/profiles/me', {
    token: state.client.token,
    body: { bio: `Hardening fixture ${index}` },
    expected: [200, 429],
  }));
  const responses = await Promise.all(tasks);
  assert(responses.every((item) => item.status < 500));
});
test('72 readiness remains healthy after bounded contention', async () => {
  const response = await api('GET', '/readyz');
  assert.equal(response.data.status, 'ready');
});
test('73 sensitive route rate limit is present and not weakened', () => {
  const text = source('apps/gateway/src/rate-limits.ts');
  assert(text.includes('maxRequests = 30'));
  assert(text.includes('reel_upload'));
  assert(text.includes('auth_login'));
});
test('74 readiness checks are bounded', () => {
  const text = source('packages/utils/src/readiness.ts');
  assert(text.includes('timeoutMs'));
  assert(text.includes('setTimeout'));
});
test('75 Docker compose keeps fake push default for local runtime', () => {
  const text = source('docker-compose.full.yml');
  assert(text.includes('MOBILE_PUSH_PROVIDER_MODE'));
  assert(text.includes('fake'));
});
test('76 Docker compose keeps mock media scanner explicitly local', () => {
  const text = source('docker-compose.full.yml');
  assert(text.includes('MEDIA_SCANNER_MODE'));
  assert(text.includes('mock'));
});
test('77 no hardening doc includes absolute local user paths', () => {
  for (const file of files('docs').filter((item) => item.endsWith('.md'))) {
    assert(!readFileSync(file, 'utf8').includes('/Users/'));
  }
});

try {
  for (const item of tests) {
    await item.fn();
    console.log(`PASS ${item.name}`);
  }
  console.log(`Release G hardening smoke: ${tests.length} passed, 0 failed`);
} catch (error) {
  console.error(`FAIL ${error?.message ? safePath(error.message) : 'hardening smoke failed'}`);
  console.error(`Release G hardening smoke: failed before completing ${tests.length} checks`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
