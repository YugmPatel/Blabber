#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

const DEFAULT_GATEWAY_URL = 'http://localhost:3000';
const gatewayUrl = (process.env.SMOKE_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
const allowUnsafeTarget = process.env.SMOKE_ALLOW_UNSAFE_TARGET === 'true';
const verbose = process.env.SMOKE_VERBOSE === 'true';
const runId = `release-b-account-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const SAFE_LOCAL_TARGETS = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal']);

const tests = [];
const state = {
  primary: null,
  helper: null,
  verificationToken: null,
  emailChangeToken: null,
  deletionCancelToken: null,
};

function assertSafeTarget() {
  const parsed = new URL(gatewayUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('SMOKE_GATEWAY_URL must use http or https.');
  if (!allowUnsafeTarget && !SAFE_LOCAL_TARGETS.has(parsed.hostname)) {
    throw new Error('Refusing to run account smoke against a non-local gateway.');
  }
}

function redact(value) {
  return String(value)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/refreshToken=[^;\s]+/gi, 'refreshToken=[redacted]')
    .replace(/token=[A-Za-z0-9._-]+/gi, 'token=[redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
}

class SmokeHttpError extends Error {
  constructor(message, safe) {
    super(message);
    this.safe = safe;
  }
}

function safeErrorContext(error) {
  if (error instanceof SmokeHttpError) return `${error.message} ${JSON.stringify(error.safe)}`;
  return redact(error?.message || error);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function makeClient(label) {
  return {
    label,
    accessToken: null,
    cookies: new Map(),
    setCookie(headers) {
      for (const value of headers.getSetCookie?.() || []) {
        const [pair] = value.split(';');
        const index = pair.indexOf('=');
        if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const fallback = headers.get('set-cookie');
      if (fallback && !headers.getSetCookie) {
        const [pair] = fallback.split(';');
        const index = pair.indexOf('=');
        if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    cookieHeader() {
      return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
    },
  };
}

async function api(method, path, { client, body, expected, parse = 'json', headers = {} } = {}) {
  const url = `${gatewayUrl}${path}`;
  const requestHeaders = {
    'User-Agent': `Blabber Release B Account Smoke (${runId}; ${client?.label || 'anon'})`,
    ...headers,
  };
  if (client?.accessToken) requestHeaders.Authorization = `Bearer ${client.accessToken}`;
  if (client?.cookies.size) requestHeaders.Cookie = client.cookieHeader();
  let requestBody;
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
    redirect: 'manual',
  });
  client?.setCookie(response.headers);

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (parse === 'buffer') data = Buffer.from(await response.arrayBuffer());
  else if (parse === 'text') data = await response.text();
  else if (response.status !== 204 && contentType.includes('application/json')) data = await response.json();
  else data = await response.text();

  if (expected !== undefined) {
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (!expectedStatuses.includes(response.status)) {
      throw new SmokeHttpError('Unexpected HTTP response', {
        method,
        path,
        status: response.status,
        error: typeof data?.error === 'string' ? data.error : undefined,
        message: typeof data?.message === 'string' ? data.message : undefined,
      });
    }
  }
  if (verbose) console.log(`  ${method} ${path} -> ${response.status}`);
  return { status: response.status, data, headers: response.headers };
}

function uniqueEmail(prefix) {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-18);
  return `${prefix}-${suffix}@example.com`;
}

async function register(label, emailPrefix) {
  const client = makeClient(label);
  const password = `SmokePass!${Math.random().toString(36).slice(2)}A1`;
  const payload = {
    username: `${emailPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 30),
    email: uniqueEmail(emailPrefix),
    password,
    name: `${label} ${runId}`,
  };
  const response = await api('POST', '/api/auth/register', { client, body: payload, expected: 201 });
  client.accessToken = response.data.accessToken;
  return { client, password, email: payload.email, user: response.data.user };
}

async function login(email, password, label) {
  const client = makeClient(label);
  const response = await api('POST', '/api/auth/login', { client, body: { email, password }, expected: 200 });
  client.accessToken = response.data.accessToken;
  return { client, user: response.data.user };
}

async function mailbox(client) {
  const response = await api('GET', '/api/auth/account/dev/mailbox', { client, expected: 200 });
  return response.data.messages || [];
}

function tokenFromPurpose(messages, purpose) {
  const message = messages.find((item) => item.purpose === purpose);
  const match = message?.text?.match(/[?&]token=([A-Za-z0-9._-]+)/);
  assert(match?.[1], `${purpose} token is present in captured mailbox`);
  return match[1];
}

async function pollExportReady(client, exportId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await api('GET', '/api/auth/account/export', { client, expected: 200 });
    const item = response.data.exports?.find((entry) => entry.id === exportId);
    if (item?.status === 'ready') return item;
    if (item?.status === 'failed') throw new Error('data export failed');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('data export did not become ready');
}

test('register captures verification email without verifying automatically', async () => {
  state.primary = await register('primary', 'rbacct');
  assertEqual(state.primary.user.emailVerified, false, 'registered user starts unverified');
  const messages = await mailbox(state.primary.client);
  state.verificationToken = tokenFromPurpose(messages, 'email_verification');
});

test('verified-only account actions reject unverified users', async () => {
  await api('POST', '/api/auth/account/export', {
    client: state.primary.client,
    body: { currentPassword: state.primary.password },
    expected: 400,
  });
});

test('email verification link is one-time', async () => {
  await api('POST', '/api/auth/account/email/verification/confirm', {
    body: { token: state.verificationToken },
    expected: 200,
  });
  await api('POST', '/api/auth/account/email/verification/confirm', {
    body: { token: state.verificationToken },
    expected: 400,
  });
  const status = await api('GET', '/api/auth/account/status', { client: state.primary.client, expected: 200 });
  assertEqual(status.data.user.emailVerified, true, 'email is verified');
});

test('email change requires password and invalidates old sessions', async () => {
  const oldClient = state.primary.client;
  const newEmail = uniqueEmail('rbacct-new');
  await api('POST', '/api/auth/account/email/change/request', {
    client: oldClient,
    body: { newEmail, currentPassword: state.primary.password },
    expected: 200,
  });
  state.emailChangeToken = tokenFromPurpose(await mailbox(oldClient), 'email_change_confirmation');
  await api('POST', '/api/auth/account/email/change/confirm', {
    body: { token: state.emailChangeToken },
    expected: 200,
  });
  await api('POST', '/api/auth/refresh', { client: oldClient, expected: 401 });
  await api('POST', '/api/auth/login', {
    body: { email: state.primary.email, password: state.primary.password },
    expected: 401,
  });
  const loggedIn = await login(newEmail, state.primary.password, 'primary-new-email');
  state.primary.email = newEmail;
  state.primary.client = loggedIn.client;
});

test('active device sessions can be listed and revoked', async () => {
  const second = await login(state.primary.email, state.primary.password, 'secondary-device');
  const sessions = await api('GET', '/api/auth/account/sessions', { client: state.primary.client, expected: 200 });
  assert(sessions.data.sessions?.length >= 2, 'at least two active sessions are listed');
  const secondSession = sessions.data.sessions.find((session) => !session.current);
  assert(secondSession?.id, 'non-current session is identifiable');
  await api('DELETE', `/api/auth/account/sessions/${secondSession.id}`, { client: state.primary.client, expected: 200 });
  await api('POST', '/api/auth/refresh', { client: second.client, expected: 401 });
});

test('logout other devices preserves the current session', async () => {
  const other = await login(state.primary.email, state.primary.password, 'other-device');
  const result = await api('POST', '/api/auth/account/sessions/logout-others', { client: state.primary.client, expected: 200 });
  assert(result.data.revoked >= 1, 'at least one other session was revoked');
  await api('POST', '/api/auth/refresh', { client: other.client, expected: 401 });
  const refreshed = await api('POST', '/api/auth/refresh', { client: state.primary.client, expected: 200 });
  state.primary.client.accessToken = refreshed.data.accessToken;
});

test('data export prepares an authenticated ZIP download', async () => {
  const requested = await api('POST', '/api/auth/account/export', {
    client: state.primary.client,
    body: { currentPassword: state.primary.password },
    expected: 202,
  });
  const ready = await pollExportReady(state.primary.client, requested.data.export.id);
  assertEqual(ready.status, 'ready', 'export status is ready');
  const zip = await api('GET', `/api/auth/account/export/${ready.id}/download`, {
    client: state.primary.client,
    expected: 200,
    parse: 'buffer',
  });
  assert(zip.data.slice(0, 2).toString('utf8') === 'PK', 'download is a ZIP file');
});

test('data export download is private to the requesting account', async () => {
  state.helper = await register('helper', 'rbacct-helper');
  const helperMessages = await mailbox(state.helper.client);
  const helperToken = tokenFromPurpose(helperMessages, 'email_verification');
  await api('POST', '/api/auth/account/email/verification/confirm', { body: { token: helperToken }, expected: 200 });
  const exports = await api('GET', '/api/auth/account/export', { client: state.primary.client, expected: 200 });
  const ready = exports.data.exports.find((item) => item.status === 'ready');
  await api('GET', `/api/auth/account/export/${ready.id}/download`, {
    client: state.helper.client,
    expected: 404,
    parse: 'buffer',
  });
});

test('account deletion deactivates immediately and can be cancelled by email link', async () => {
  await api('POST', '/api/auth/account/deletion', {
    client: state.primary.client,
    body: { currentPassword: state.primary.password, confirmation: 'DELETE' },
    expected: 202,
  });
  await api('POST', '/api/auth/login', {
    body: { email: state.primary.email, password: state.primary.password },
    expected: 401,
  });
  state.deletionCancelToken = tokenFromPurpose(await mailbox(state.primary.client), 'account_deletion_requested');
  await api('POST', '/api/auth/account/deletion/cancel', {
    body: { token: state.deletionCancelToken },
    expected: 200,
  });
  const restored = await login(state.primary.email, state.primary.password, 'primary-restored');
  state.primary.client = restored.client;
});

test('account deletion finalization removes the account after the retention window', async () => {
  const deletion = await api('POST', '/api/auth/account/deletion', {
    client: state.primary.client,
    body: { currentPassword: state.primary.password, confirmation: 'DELETE' },
    expected: 202,
  });
  state.deletionCancelToken = tokenFromPurpose(await mailbox(state.primary.client), 'account_deletion_requested');
  const future = new Date(new Date(deletion.data.deletion.scheduledFor).getTime() + 60_000).toISOString();
  const worker = await api('POST', '/api/auth/account/deletion/worker/run', {
    client: state.helper.client,
    body: { now: future },
    expected: 200,
  });
  assert(worker.data.finalized >= 1, 'deletion worker finalized account');
  await api('POST', '/api/auth/account/deletion/cancel', {
    body: { token: state.deletionCancelToken },
    expected: 400,
  });
  await api('POST', '/api/auth/login', {
    body: { email: state.primary.email, password: state.primary.password },
    expected: 401,
  });
});

async function run() {
  assertSafeTarget();
  const startedAt = performance.now();
  const failures = [];
  console.log(`Release B account smoke run ${runId}`);
  console.log(`Gateway: ${gatewayUrl}`);

  for (const entry of tests) {
    const caseStart = performance.now();
    try {
      await entry.fn();
      console.log(`PASS ${entry.name} (${Math.round(performance.now() - caseStart)}ms)`);
    } catch (error) {
      failures.push({ name: entry.name, error });
      console.log(`FAIL ${entry.name} (${Math.round(performance.now() - caseStart)}ms)`);
      console.log(`  ${safeErrorContext(error)}`);
    }
  }

  const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
  const passed = tests.length - failures.length;
  console.log(`Release B account smoke complete: ${passed} passed, ${failures.length} failed (${duration}s)`);
  if (failures.length) {
    console.log(`Failed cases: ${failures.map((failure) => failure.name).join('; ')}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.log(`Release B account smoke aborted: ${safeErrorContext(error)}`);
  process.exitCode = 1;
});
