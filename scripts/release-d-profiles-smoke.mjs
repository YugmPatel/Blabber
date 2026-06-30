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
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `reld_${label}_${unique}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-d-profiles-${label}-${unique}@example.com`,
      password: 'SmokePass123!',
      name: `Profiles ${label}`,
    },
    expected: 201,
  });
  const token = response.data.accessToken || response.data.token || response.data.access?.token;
  assert(token, `${label} token is present`);
  return { token, user: response.data.user };
}

async function setHandle(client, handle) {
  const response = await api('PATCH', '/api/profiles/me/handle', { client, body: { handle } });
  return response.data.profile;
}

async function updateProfile(client, patch) {
  const response = await api('PATCH', '/api/profiles/me', { client, body: patch });
  return response.data.profile;
}

function allMoments(feed) {
  return [...feed.recentMoments, ...feed.viewedMoments, ...feed.myMoments];
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 users start without public profile handles', async () => {
  state.prefix = `reld_${Math.random().toString(36).slice(2, 8)}`;
  state.ownerHandle = `${state.prefix}_owner`;
  state.viewerHandle = `${state.prefix}_viewer`;
  state.otherHandle = `${state.prefix}_other`;
  state.blockedHandle = `${state.prefix}_blocked`;
  state.owner = await register('owner');
  state.viewer = await register('viewer');
  state.other = await register('other');
  state.blocked = await register('blocked');
  const profile = await api('GET', '/api/profiles/me', { client: state.owner });
  assert.equal(profile.data.profile.handle, null);
  assert.equal(profile.data.profile.visibility, 'private');
});

test('03 handle validation rejects reserved and duplicate values', async () => {
  await api('PATCH', '/api/profiles/me/handle', { client: state.owner, body: { handle: 'admin' }, expected: 400 });
  await setHandle(state.owner, state.ownerHandle);
  await setHandle(state.viewer, state.viewerHandle);
  await api('PATCH', '/api/profiles/me/handle', { client: state.other, body: { handle: state.ownerHandle.toUpperCase() }, expected: 409 });
});

test('04 profile update stores safe public fields only', async () => {
  const profile = await updateProfile(state.owner, {
    name: 'Profiles Owner',
    bio: 'release d profile bio',
    website: 'https://example.com/profile',
    visibility: 'private',
  });
  assert.equal(profile.bio, 'release d profile bio');
  assert.equal(profile.website, 'https://example.com/profile');
  assert.equal(profile.counts.followers, 0);
  await api('PATCH', '/api/profiles/me', { client: state.owner, body: { website: 'http://example.com' }, expected: 400 });
});

test('05 anonymous exact-handle profile access is denied', async () => {
  await api('GET', `/api/profiles/${state.ownerHandle}`, { expected: 401 });
});

test('06 private profile locks details for non-followers', async () => {
  const response = await api('GET', `/api/profiles/${state.ownerHandle}`, { client: state.viewer });
  assert.equal(response.data.profile.locked, true);
  assert.equal(response.data.profile.bio, undefined);
  assert.equal(response.data.profile.counts, undefined);
});

test('07 private follow request stays locked until owner approval', async () => {
  const requested = await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.viewer });
  assert.equal(requested.data.profile.relationship, 'requested_outgoing');
  assert.equal(requested.data.profile.bio, undefined);
  const incoming = await api('GET', '/api/profiles/requests/incoming', { client: state.owner });
  assert.equal(incoming.data.requests.length, 1);
  assert.equal(incoming.data.requests[0].requester.handle, state.viewerHandle);
  await api('POST', `/api/profiles/requests/${state.viewerHandle}/approve`, { client: state.owner });
  const full = await api('GET', `/api/profiles/${state.ownerHandle}`, { client: state.viewer });
  assert.equal(full.data.profile.relationship, 'following');
  assert.equal(full.data.profile.bio, 'release d profile bio');
});

test('08 public profile follows immediately and unfollows safely', async () => {
  await setHandle(state.other, state.otherHandle);
  await updateProfile(state.other, { visibility: 'public', bio: 'public profile' });
  const followed = await api('POST', `/api/profiles/${state.otherHandle}/follow`, { client: state.viewer });
  assert.equal(followed.data.profile.relationship, 'following');
  const unfollowed = await api('DELETE', `/api/profiles/${state.otherHandle}/follow`, { client: state.viewer });
  assert.equal(unfollowed.data.profile.relationship, 'none');
});

test('09 request cancellation and decline are idempotent-safe', async () => {
  await api('POST', `/api/profiles/${state.viewerHandle}/follow`, { client: state.other });
  await api('POST', `/api/profiles/${state.viewerHandle}/cancel`, { client: state.other });
  await api('POST', `/api/profiles/${state.viewerHandle}/cancel`, { client: state.other });
  await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.other });
  await api('POST', `/api/profiles/requests/${state.otherHandle}/decline`, { client: state.owner });
  const locked = await api('GET', `/api/profiles/${state.ownerHandle}`, { client: state.other });
  assert.equal(locked.data.profile.relationship, 'none');
});

test('10 block revokes follows and denies profile access', async () => {
  await setHandle(state.blocked, state.blockedHandle);
  await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.blocked });
  await api('POST', `/api/users/${state.blocked.user._id}/block`, { client: state.owner });
  await api('GET', `/api/profiles/${state.ownerHandle}`, { client: state.blocked, expected: 404 });
});

test('11 follow relationship does not grant Moment contact access', async () => {
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'release d moment body', audienceType: 'contacts' },
    expected: 201,
  });
  const feed = await api('GET', '/api/moments/feed', { client: state.viewer });
  assert(!allMoments(feed.data).some((moment) => moment._id === created.data.moment._id), 'follower without direct chat cannot see contacts Moment');
});

test('12 handle cooldown prevents immediate second change', async () => {
  await api('PATCH', '/api/profiles/me/handle', { client: state.viewer, body: { handle: `${state.prefix}_next` }, expected: 429 });
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
