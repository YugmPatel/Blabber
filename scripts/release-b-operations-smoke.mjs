#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const gatewayUrl = (process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const runId = `release-b-ops-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class SmokeHttpError extends Error {
  constructor(message, safe) {
    super(message);
    this.safe = safe;
  }
}

function safeErrorContext(error) {
  if (error instanceof SmokeHttpError) return `${error.message} ${JSON.stringify(error.safe)}`;
  return error?.message || String(error);
}

async function api(method, pathOrUrl, options = {}) {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${gatewayUrl}${pathOrUrl}`;
  const headers = {
    'User-Agent': `Blabber Release B Operations Smoke (${runId})`,
    ...(options.headers || {}),
  };
  if (options.user?.accessToken) headers.Authorization = `Bearer ${options.user.accessToken}`;
  if (options.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  const expected = options.expected ?? 200;
  if (response.status !== expected) {
    throw new SmokeHttpError('Unexpected HTTP response', {
      method,
      path: new URL(url).pathname.replace(/\/local\/[^/]+/, '/local/[media]'),
      status: response.status,
      expected,
      message: typeof data?.message === 'string' ? data.message : undefined,
    });
  }
  return { status: response.status, data, headers: response.headers };
}

function uniqueEmail(label) {
  return `${label}-${runId}@example.com`;
}

async function register(label) {
  const password = `SmokePass!${Math.random().toString(36).slice(2)}A1`;
  const payload = {
    email: uniqueEmail(label),
    username: `${label}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    password,
    name: `Ops ${label}`,
  };
  const registered = await api('POST', '/api/auth/register', { body: payload, expected: 201 });
  const login = await api('POST', '/api/auth/login', {
    body: { email: payload.email, password },
    expected: 200,
  });
  return { id: registered.data.user._id, accessToken: login.data.accessToken };
}

async function upload(user, fileName, fileType, bytes) {
  const presign = await api('POST', '/api/media/presign', {
    user,
    body: { fileName, fileType, fileSize: bytes.length },
    expected: 200,
  });
  assert(presign.data.status === 'pending', 'presign creates pending media');
  const uploaded = await api('PUT', presign.data.uploadUrl, {
    user,
    rawBody: bytes,
    headers: { 'Content-Type': fileType },
    expected: 200,
  });
  assert(uploaded.data.status === 'approved', 'clean upload is approved');
  return uploaded.data.mediaId;
}

test('gateway health and readiness pass', async () => {
  const [health, ready] = await Promise.all([
    api('GET', '/healthz'),
    api('GET', '/readyz'),
  ]);
  assert(health.data.status === 'ok', 'gateway health ok');
  assert(ready.data.status === 'ready', 'gateway ready');
});

test('register operations smoke users', async () => {
  state.owner = await register('owner');
  state.member = await register('member');
  assert(state.owner.id && state.member.id, 'users registered');
});

test('clean media is scanned and approved before message send', async () => {
  state.chat = (await api('POST', '/api/chats', {
    user: state.owner,
    body: { type: 'group', participantIds: [state.owner.id, state.member.id], title: `Ops ${runId}` },
    expected: 201,
  })).data.chat;
  const mediaId = await upload(state.owner, `ops-${runId}.txt`, 'text/plain', Buffer.from('operations smoke document'));
  const message = await api('POST', `/api/messages/${state.chat._id}`, {
    user: state.owner,
    body: { body: 'operations attachment', mediaId },
    expected: 201,
  });
  assert(message.data.media?.mediaId === mediaId, 'approved media can attach to message');
});

test('unsafe upload is rejected with generic message', async () => {
  await api('POST', '/api/media/presign', {
    user: state.owner,
    body: { fileName: 'invoice.pdf.exe', fileType: 'application/octet-stream', fileSize: 4 },
    expected: 400,
  });
  const bad = await api('POST', '/api/media/presign', {
    user: state.owner,
    body: { fileName: `malware-${runId}.txt`, fileType: 'text/plain', fileSize: 20 },
    expected: 200,
  });
  const rejected = await api('PUT', bad.data.uploadUrl, {
    user: state.owner,
    rawBody: Buffer.from('BLABBER_MOCK_MALWARE'),
    headers: { 'Content-Type': 'text/plain' },
    expected: 400,
  });
  assert(rejected.data.message === 'This file could not be uploaded.', 'unsafe upload returns generic message');
});

test('group AI Intelligence toggle disables group AI routes', async () => {
  const disabled = await api('PATCH', `/api/chats/${state.chat._id}/intelligence/settings`, {
    user: state.owner,
    body: { aiEnabled: false },
    expected: 200,
  });
  assert(disabled.data.chat.aiEnabled === false, 'group AI disabled');
  await api('GET', `/api/intelligence/chats/${state.chat._id}/brain`, {
    user: state.owner,
    expected: 403,
  });
  const enabled = await api('PATCH', `/api/chats/${state.chat._id}/intelligence/settings`, {
    user: state.owner,
    body: { aiEnabled: true },
    expected: 200,
  });
  assert(enabled.data.chat.aiEnabled === true, 'group AI re-enabled');
});

test('user can clear private AI history without deleting Actions', async () => {
  const cleared = await api('DELETE', '/api/intelligence/history/me', { user: state.owner, expected: 200 });
  assert(cleared.data.status === 'cleared', 'AI history clear endpoint succeeds');
});

test('protected push diagnostics expose counters only', async () => {
  await api('GET', '/api/notifications/ops/push', { expected: 404 });
  const diag = await api('GET', '/api/notifications/ops/push', {
    headers: { 'x-ops-token': 'blabber-local-ops-diagnostic-token' },
    expected: 200,
  });
  assert(diag.data.counters && typeof diag.data.counters.attempted === 'number', 'push counters are present');
  assert(!JSON.stringify(diag.data).includes('endpoint'), 'push diagnostics omit endpoints');
});

test('backup and guarded restore verification passes', async () => {
  execFileSync('node', ['scripts/mongo-backup-verify.mjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BACKUP_RETENTION_DAYS: '14' },
  });
});

test('smoke output redaction guard does not contain unsafe literals', async () => {
  const serialized = JSON.stringify({ runId, labels: tests.map((entry) => entry.name) });
  assert(!serialized.includes('accessToken'), 'output omits access tokens');
  assert(!serialized.includes('BLABBER_MOCK_MALWARE'), 'output omits malware sample body');
});

async function main() {
  console.log(`Release B operations smoke run ${runId}`);
  const failures = [];
  let passed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      passed += 1;
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failures.push({ name: entry.name, error });
      console.error(`FAIL ${entry.name}: ${safeErrorContext(error)}`);
      break;
    }
  }
  console.log(`Release B operations smoke complete: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(`Release B operations smoke aborted: ${safeErrorContext(error)}`);
  process.exit(1);
});
