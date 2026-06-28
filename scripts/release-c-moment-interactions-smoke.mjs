#!/usr/bin/env node
import assert from 'node:assert/strict';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const VERBOSE = process.env.SMOKE_VERBOSE === 'true';
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function safePath(path) {
  return path.replace(/[a-f0-9]{24}/gi, ':id');
}

function safeLog(message) {
  if (VERBOSE) console.log(message);
}

async function api(method, path, { client, body, expected = 200 } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(client?.token ? { authorization: `Bearer ${client.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    throw new Error(`${method} ${safePath(path)} returned ${response.status}`);
  }
  safeLog(`  ${method} ${safePath(path)} -> ${response.status}`);
  return { status: response.status, data };
}

async function register(label) {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `release-c-moment-interactions-${label}-${unique}@example.com`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `moment_${label}_${unique}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email,
      password: 'SmokePass123!',
      name: `Moment ${label}`,
    },
    expected: 201,
  });
  const token = response.data.accessToken || response.data.token || response.data.access?.token;
  assert(token, `${label} token is present`);
  return { token, user: response.data.user };
}

async function createDirect(client, participantId) {
  const response = await api('POST', '/api/chats', {
    client,
    body: { type: 'direct', participantIds: [client.user._id, participantId] },
    expected: [200, 201],
  });
  return response.data.chat || response.data;
}

function allMoments(feed) {
  return [...feed.recentMoments, ...feed.viewedMoments, ...feed.myMoments];
}

test('01 health and users are ready', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  state.author = await register('author');
  state.viewer = await register('viewer');
  state.other = await register('other');
  state.directChat = await createDirect(state.author, state.viewer.user._id);
  await createDirect(state.author, state.other.user._id);
});

test('02 Moment notification preferences include defaults and ownership guard', async () => {
  const own = await api('GET', `/api/notifications/preferences/${state.viewer.user._id}`, { client: state.viewer });
  assert.equal(own.data.preferences.momentUpdatesEnabled, false);
  assert.equal(own.data.preferences.momentActivityEnabled, true);
  await api('PATCH', `/api/notifications/preferences/${state.viewer.user._id}`, {
    client: state.viewer,
    body: { momentUpdatesEnabled: true },
  });
  await api('GET', `/api/notifications/preferences/${state.author.user._id}`, {
    client: state.viewer,
    expected: 403,
  });
});

test('03 viewer can react privately and only own reaction appears in feed', async () => {
  const created = await api('POST', '/api/moments', {
    client: state.author,
    body: { type: 'text', textBody: 'interaction smoke body', audienceType: 'contacts' },
    expected: 201,
  });
  state.moment = created.data.moment;

  await api('POST', `/api/moments/${state.moment._id}/reaction`, {
    client: state.viewer,
    body: { emoji: '🙌' },
  });
  const viewerFeed = await api('GET', '/api/moments/feed', { client: state.viewer });
  const viewerMoment = allMoments(viewerFeed.data).find((moment) => moment._id === state.moment._id);
  assert.equal(viewerMoment.myReaction, '🙌');
  assert.equal(viewerMoment.reactionCount, undefined);
  assert.equal(viewerMoment.reactions, undefined);

  const otherFeed = await api('GET', '/api/moments/feed', { client: state.other });
  const otherMoment = allMoments(otherFeed.data).find((moment) => moment._id === state.moment._id);
  assert(otherMoment, 'other eligible viewer sees Moment');
  assert.equal(otherMoment.myReaction, undefined);
  assert.equal(otherMoment.reactions, undefined);
});

test('04 author sees interactions and non-author cannot', async () => {
  const denied = await api('GET', `/api/moments/${state.moment._id}/interactions`, {
    client: state.viewer,
    expected: 404,
  });
  assert(denied.data.message.includes('Moment'), 'non-author interactions are denied generically');
  const interactions = await api('GET', `/api/moments/${state.moment._id}/interactions`, { client: state.author });
  const viewer = interactions.data.interactions.find((item) => item.viewer._id === state.viewer.user._id);
  assert.equal(viewer.reaction.emoji, '🙌');
  assert(!viewer.viewer.email, 'viewer email is not exposed');
});

test('05 Moment reply creates safe direct message metadata only', async () => {
  const reply = await api('POST', `/api/moments/${state.moment._id}/reply`, {
    client: state.viewer,
    body: { body: 'private reply from smoke' },
    expected: 201,
  });
  assert.equal(reply.data.message.body, 'private reply from smoke');
  assert.equal(reply.data.message.momentReply.label, 'Replied to a Moment');
  assert.equal(reply.data.message.momentReply.momentId, undefined);

  const messages = await api('GET', `/api/messages/${state.directChat._id || state.directChat.id}`, { client: state.author });
  const found = messages.data.messages.find((message) => message._id === reply.data.message._id);
  assert(found, 'reply appears in direct chat');
  assert.equal(found.momentReply.label, 'Replied to a Moment');
  assert.equal(found.momentReply.momentId, undefined);
});

test('06 invalid interactions fail generically', async () => {
  await api('POST', `/api/moments/${state.moment._id}/reaction`, {
    client: state.author,
    body: { emoji: '😂' },
    expected: 404,
  });
  await api('POST', `/api/moments/${state.moment._id}/reply`, {
    client: state.other,
    body: { body: 'before block' },
    expected: 201,
  });
  await api('POST', `/api/users/${state.other.user._id}/block`, { client: state.author });
  const denied = await api('POST', `/api/moments/${state.moment._id}/reply`, {
    client: state.other,
    body: { body: 'after block' },
    expected: 404,
  });
  assert.equal(denied.data.message, 'This reply is unavailable.');
});

test('07 reaction removal clears only viewer state', async () => {
  await api('DELETE', `/api/moments/${state.moment._id}/reaction`, { client: state.viewer });
  const viewerFeed = await api('GET', '/api/moments/feed', { client: state.viewer });
  const viewerMoment = allMoments(viewerFeed.data).find((moment) => moment._id === state.moment._id);
  assert.equal(viewerMoment.myReaction, undefined);
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    passed += 1;
    console.log(`ok ${passed} - ${entry.name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${entry.name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

console.log(`${passed} passed, 0 failed`);
