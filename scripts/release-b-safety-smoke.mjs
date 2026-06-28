#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const gatewayUrl = (process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const mongoDbName = process.env.MONGO_DB_NAME || process.env.MONGODB_DB || 'blabber_full';
const mongoContainer = process.env.SMOKE_MONGO_CONTAINER || 'blabber-full-mongodb';
const runId = `release-b-safety-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = { users: {}, chats: {}, messages: {}, reports: {} };

function redact(value) {
  return String(value)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/refreshToken=[^;\s]+/gi, 'refreshToken=[redacted]')
    .replace(/\/join\/[A-Za-z0-9_-]+/g, '/join/[redacted]')
    .replace(/\/api\/invites\/[A-Za-z0-9_-]+/g, '/api/invites/[redacted]')
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

async function api(method, path, { user, body, expected } = {}) {
  const headers = { 'User-Agent': `Blabber Release B Safety Smoke (${runId})` };
  if (user?.accessToken) headers.Authorization = `Bearer ${user.accessToken}`;
  let requestBody;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${gatewayUrl}${path}`, { method, headers, body: requestBody, redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  const data = response.status !== 204 && contentType.includes('application/json') ? await response.json() : await response.text();
  if (expected !== undefined) {
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (!expectedStatuses.includes(response.status)) {
      throw new SmokeHttpError('Unexpected HTTP response', {
        method,
        path: redact(path),
        status: response.status,
        error: typeof data?.error === 'string' ? data.error : undefined,
        message: typeof data?.message === 'string' ? data.message : undefined,
      });
    }
  }
  return { status: response.status, data, headers: response.headers };
}

async function register(key) {
  const password = `SmokePass!${Math.random().toString(36).slice(2)}A1`;
  const cleanRunId = runId.replace(/[^a-z0-9]/gi, '').slice(-18);
  const payload = {
    username: `rbs_${key}_${cleanRunId}`.slice(0, 30),
    email: `rbs-${key}-${cleanRunId}@example.com`,
    password,
    name: `RBS ${key}`,
  };
  const response = await api('POST', '/api/auth/register', { body: payload, expected: 201 });
  return { ...payload, password, accessToken: response.data.accessToken, id: response.data.user._id };
}

async function grantModerator(userId) {
  execFileSync('docker', [
    'exec',
    mongoContainer,
    'mongosh',
    mongoDbName,
    '--quiet',
    '--eval',
    `db.users.updateOne({_id:ObjectId("${userId}")},{$set:{platformRole:"moderator",updatedAt:new Date()}});`,
  ], { stdio: 'ignore' });
}

test('registers disposable users and bootstraps moderator role', async () => {
  state.users.alice = await register('alice');
  state.users.bob = await register('bob');
  state.users.cara = await register('cara');
  state.users.mod = await register('mod');
  await grantModerator(state.users.mod.id);
});

test('blocking prevents direct chat creation and exposes private blocked list', async () => {
  await api('POST', `/api/users/${state.users.bob.id}/block`, { user: state.users.alice, expected: 200 });
  const blocked = await api('GET', '/api/users/blocked', { user: state.users.alice, expected: 200 });
  assert(blocked.data.blockedUsers.some((item) => item.userId === state.users.bob.id), 'blocked list includes Bob');
  await api('POST', '/api/chats', {
    user: state.users.alice,
    body: { type: 'direct', participantIds: [state.users.alice.id, state.users.bob.id] },
    expected: 403,
  });
});

test('unblock restores direct chat and direct send eligibility', async () => {
  await api('DELETE', `/api/users/${state.users.bob.id}/block`, { user: state.users.alice, expected: 200 });
  const chat = await api('POST', '/api/chats', {
    user: state.users.alice,
    body: { type: 'direct', participantIds: [state.users.alice.id, state.users.bob.id] },
    expected: 201,
  });
  state.chats.direct = chat.data.chat;
  const message = await api('POST', `/api/messages/${state.chats.direct._id}`, {
    user: state.users.alice,
    body: { body: 'release b safety direct body', type: 'text' },
    expected: 201,
  });
  state.messages.direct = message.data;
});

test('message report is accepted with coarse reporter history', async () => {
  const report = await api('POST', '/api/reports', {
    user: state.users.bob,
    body: { targetType: 'message', targetId: state.messages.direct._id, reason: 'Smoke message report' },
    expected: 201,
  });
  state.reports.message = report.data.report;
  const mine = await api('GET', '/api/reports/mine', { user: state.users.bob, expected: 200 });
  assert(mine.data.reports.some((item) => item.id === state.reports.message.id), 'report history includes submitted report');
  assert(!JSON.stringify(mine.data).includes('release b safety direct body'), 'report history omits message bodies');
});

test('moderator can review report and normal users cannot', async () => {
  await api('GET', '/api/moderation/reports', { user: state.users.alice, expected: 403 });
  const reports = await api('GET', '/api/moderation/reports', { user: state.users.mod, expected: 200 });
  assert(reports.data.reports.some((item) => item.id === state.reports.message.id), 'moderation queue includes report');
  await api('PATCH', `/api/moderation/reports/${state.reports.message.id}`, {
    user: state.users.mod,
    body: { status: 'reviewing', internalNote: 'Smoke reviewed without raw content.' },
    expected: 200,
  });
});

test('group moderation send mode blocks regular members but allows admins', async () => {
  const group = await api('POST', '/api/chats', {
    user: state.users.alice,
    body: { type: 'group', title: 'Release B Safety Group', participantIds: [state.users.alice.id, state.users.bob.id, state.users.cara.id] },
    expected: 201,
  });
  state.chats.group = group.data.chat;
  await api('PATCH', `/api/chats/${state.chats.group._id}/moderation/settings`, {
    user: state.users.alice,
    body: { sendMode: 'admins_only' },
    expected: 200,
  });
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.bob,
    body: { body: 'blocked group send body', type: 'text' },
    expected: 403,
  });
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.alice,
    body: { body: 'admin group send body', type: 'text' },
    expected: 201,
  });
});

test('individual send restriction and unrestriction are enforced', async () => {
  await api('PATCH', `/api/chats/${state.chats.group._id}/moderation/settings`, {
    user: state.users.alice,
    body: { sendMode: 'everyone' },
    expected: 200,
  });
  await api('POST', `/api/chats/${state.chats.group._id}/moderation/members/${state.users.bob.id}/restrict`, {
    user: state.users.alice,
    expected: 200,
  });
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.bob,
    body: { body: 'restricted member body', type: 'text' },
    expected: 403,
  });
  await api('DELETE', `/api/chats/${state.chats.group._id}/moderation/members/${state.users.bob.id}/restrict`, {
    user: state.users.alice,
    expected: 200,
  });
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.bob,
    body: { body: 'unrestricted member body', type: 'text' },
    expected: 201,
  });
});

test('moderation remove writes owner/admin-only activity', async () => {
  await api('DELETE', `/api/chats/${state.chats.group._id}/moderation/members/${state.users.cara.id}`, {
    user: state.users.alice,
    expected: 200,
  });
  await api('GET', `/api/chats/${state.chats.group._id}/moderation/activity`, { user: state.users.bob, expected: 403 });
  const activity = await api('GET', `/api/chats/${state.chats.group._id}/moderation/activity`, {
    user: state.users.alice,
    expected: 200,
  });
  assert(activity.data.activity.some((item) => item.action === 'member_removed'), 'activity includes member removal');
  assert(!JSON.stringify(activity.data).includes('@example.com'), 'activity omits email addresses');
});

test('group report is accepted and target is not notified through response data', async () => {
  const report = await api('POST', '/api/reports', {
    user: state.users.bob,
    body: { targetType: 'group', targetId: state.chats.group._id, reason: 'Smoke group report' },
    expected: 201,
  });
  assertEqual(report.data.report.targetType, 'group', 'group report target type');
  assert(!JSON.stringify(report.data).includes('participants'), 'report create response is coarse');
});

test('smoke output redaction guard does not contain unsafe literals', async () => {
  const summaryProbe = JSON.stringify({
    reports: Object.keys(state.reports),
    chats: Object.keys(state.chats),
    users: Object.keys(state.users),
  });
  assert(!summaryProbe.includes('release b safety direct body'), 'summary probe omits bodies');
  assert(!summaryProbe.includes('/join/'), 'summary probe omits invite URLs');
});

async function main() {
  const started = Date.now();
  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}: ${safeErrorContext(error)}`);
      break;
    }
  }
  console.log(`Release B safety smoke result: ${passed} passed, ${failed} failed (${Date.now() - started}ms)`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL smoke harness: ${safeErrorContext(error)}`);
  process.exit(1);
});
