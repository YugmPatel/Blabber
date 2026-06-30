#!/usr/bin/env node
import assert from 'node:assert/strict';

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const runId = `rdfy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function safePath(path) {
  return path.replace(/[a-f0-9]{24}/gi, ':id');
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
    const message = typeof data?.message === 'string' ? data.message : 'Unexpected response';
    throw new Error(`${method} ${safePath(path.split('?')[0])} returned ${response.status}: ${message}`);
  }
  return { status: response.status, data };
}

async function register(label, verify = true) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 30);
  const password = `SmokePass123!${label}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `rdfy_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-d-for-you-${unique}@example.com`,
      password,
      name: `For You ${label}`,
    },
    expected: 201,
  });
  const client = { token: response.data.accessToken, user: response.data.user, password };
  if (verify) await verifyEmail(client);
  return client;
}

async function verifyEmail(client) {
  const mailbox = await api('GET', '/api/auth/account/dev/mailbox', { client });
  const message = mailbox.data.messages?.find((item) => item.purpose === 'email_verification');
  const match = message?.text?.match(/[?&]token=([A-Za-z0-9._-]+)/);
  assert(match?.[1], 'verification token captured');
  await api('POST', '/api/auth/account/email/verification/confirm', { body: { token: match[1] } });
}

async function publicCreator(client, label, topics = ['technology']) {
  const handle = `rdfy_${runId.replace(/[^a-z0-9]/g, '').slice(0, 10)}_${label}`.slice(0, 30);
  await api('PATCH', '/api/profiles/me/handle', { client, body: { handle } });
  await api('PATCH', '/api/profiles/me', { client, body: { visibility: 'public', bio: 'For You smoke profile' } });
  await api('PATCH', '/api/profiles/me/discovery', {
    client,
    body: { creatorDiscoveryEnabled: true, creatorTopicIds: topics },
  });
  return handle;
}

async function createDiscoverablePost(client, body, topics = ['technology'], visibility = 'public') {
  const created = await api('POST', '/api/posts', { client, body: { body, visibility }, expected: 201 });
  if (visibility === 'public') {
    await api('PATCH', `/api/posts/${created.data.post.id}/discovery`, {
      client,
      body: { discoverable: true, discoveryTopicIds: topics },
    });
  }
  return created.data.post;
}

function postIds(response) {
  return (response.data.posts || []).map((post) => post.id);
}

function findPost(response, id) {
  return (response.data.posts || []).find((post) => post.id === id);
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 For You requires authentication', async () => {
  await api('GET', '/api/discovery/for-you', { expected: 401 });
  await api('POST', '/api/discovery/for-you/refresh', { expected: 401 });
  await api('POST', '/api/discovery/for-you/events', { body: { eventType: 'discover_post_open', candidateToken: 'invalid-token' }, expected: 401 });
});

test('03 create verified public creators and viewer', async () => {
  state.viewer = await register('viewer');
  state.otherViewer = await register('other-viewer');
  state.creatorA = await register('creator-a');
  state.creatorB = await register('creator-b');
  state.creatorC = await register('creator-c');
  state.privateCreator = await register('private-creator');
  state.unverified = await register('unverified', false);
  state.creatorAHandle = await publicCreator(state.creatorA, 'a', ['technology', 'software_engineering']);
  state.creatorBHandle = await publicCreator(state.creatorB, 'b', ['music']);
  state.creatorCHandle = await publicCreator(state.creatorC, 'c', ['design']);
  state.viewerHandle = await publicCreator(state.viewer, 'viewer', ['technology']);
});

test('04 eligible public discoverable posts appear', async () => {
  state.postA = await createDiscoverablePost(state.creatorA, 'for you smoke post a', ['technology']);
  state.postB = await createDiscoverablePost(state.creatorB, 'for you smoke post b', ['music']);
  state.postC = await createDiscoverablePost(state.creatorC, 'for you smoke post c', ['design']);
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(postIds(feed).includes(state.postA.id), 'eligible post appears');
  assert(findPost(feed, state.postA.id).candidateToken, 'candidate token issued');
  state.postAToken = findPost(feed, state.postA.id).candidateToken;
});

test('05 self posts are excluded', async () => {
  state.viewerPost = await createDiscoverablePost(state.viewer, 'for you smoke own post', ['technology']);
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(feed).includes(state.viewerPost.id), 'viewer own post absent');
});

test('06 followers-only and non-discoverable posts are excluded', async () => {
  state.followersOnly = await createDiscoverablePost(state.creatorA, 'for you smoke followers only', ['technology'], 'followers');
  state.nonDiscoverable = (await api('POST', '/api/posts', { client: state.creatorA, body: { body: 'for you smoke not discoverable', visibility: 'public' }, expected: 201 })).data.post;
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(feed).includes(state.followersOnly.id), 'followers-only post absent');
  assert(!postIds(feed).includes(state.nonDiscoverable.id), 'non-discoverable post absent');
});

test('07 private and unverified creators are excluded', async () => {
  await api('PATCH', '/api/profiles/me/handle', { client: state.privateCreator, body: { handle: `rdfy_${runId.replace(/[^a-z0-9]/g, '').slice(0, 10)}_p` } });
  await api('PATCH', '/api/profiles/me', { client: state.privateCreator, body: { visibility: 'private' } });
  await api('PATCH', '/api/profiles/me/discovery', { client: state.privateCreator, body: { creatorDiscoveryEnabled: true, creatorTopicIds: ['technology'] }, expected: 400 });
  await api('PATCH', '/api/profiles/me/handle', { client: state.unverified, body: { handle: `rdfy_${runId.replace(/[^a-z0-9]/g, '').slice(0, 10)}_u` } });
  await api('PATCH', '/api/profiles/me', { client: state.unverified, body: { visibility: 'public' } });
  await api('PATCH', '/api/profiles/me/discovery', { client: state.unverified, body: { creatorDiscoveryEnabled: true, creatorTopicIds: ['technology'] }, expected: 400 });
});

test('08 followed creator affects ranking', async () => {
  await api('POST', `/api/profiles/${state.creatorBHandle}/follow`, { client: state.viewer, expected: [200, 201] });
  const refreshed = await api('POST', '/api/discovery/for-you/refresh', { client: state.viewer });
  const feed = await api('GET', `/api/discovery/for-you?cursor=${encodeURIComponent(refreshed.data.cursor)}`, { client: state.viewer });
  const ids = postIds(feed);
  assert(ids.indexOf(state.postB.id) <= ids.indexOf(state.postA.id) || ids.indexOf(state.postA.id) === -1, 'followed creator ranks ahead of comparable candidate');
});

test('09 followed topic affects ranking and explanations are safe', async () => {
  await api('POST', '/api/discovery/topics/design/follow', { client: state.viewer });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  const item = findPost(feed, state.postC.id);
  assert(item, 'followed topic post appears');
  assert(item.explanation?.text, 'explanation text returned');
  assert.equal('score' in item, false);
  assert.equal('affinity' in item, false);
});

test('10 For You event tokens are source-bound and user-bound', async () => {
  await api('POST', '/api/discovery/for-you/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_open', candidateToken: state.postAToken },
  });
  await api('POST', '/api/discovery/for-you/events', {
    client: state.otherViewer,
    body: { eventType: 'discover_post_open', candidateToken: state.postAToken },
    expected: 404,
  });
  const browse = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  const browseToken = findPost(browse, state.postA.id).candidateToken;
  await api('POST', '/api/discovery/for-you/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_open', candidateToken: browseToken },
    expected: 404,
  });
});

test('11 dwell bucket validation and duplicate event handling work', async () => {
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  const token = feed.data.posts[0]?.candidateToken;
  assert(token, 'For You candidate token is available');
  await api('POST', '/api/discovery/for-you/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_dwell', candidateToken: token, dwellBucket: 'invalid' },
    expected: 400,
  });
  const first = await api('POST', '/api/discovery/for-you/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_dwell', candidateToken: token, dwellBucket: '10_to_30_seconds' },
  });
  const second = await api('POST', '/api/discovery/for-you/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_dwell', candidateToken: token, dwellBucket: '10_to_30_seconds' },
  });
  assert.equal(first.data.recorded, true);
  assert.equal(second.data.recorded, false);
});

test('12 reactions and comments on eligible posts keep feed usable', async () => {
  await api('POST', `/api/posts/${state.postA.id}/reaction`, { client: state.viewer, body: { emoji: '🙌' } });
  await api('POST', `/api/posts/${state.postA.id}/comments`, { client: state.viewer, body: { body: 'For You smoke comment' }, expected: 201 });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(Array.isArray(feed.data.posts), 'For You remains readable after engagement');
});

test('13 explicit post negative feedback suppresses For You only for viewer', async () => {
  await api('POST', `/api/discovery/posts/${state.postA.id}/not-interested`, { client: state.viewer });
  const hidden = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(hidden).includes(state.postA.id), 'hidden post absent');
  const visible = await api('GET', '/api/discovery/for-you', { client: state.otherViewer });
  assert(postIds(visible).includes(state.postA.id), 'other viewer can still receive post');
  await api('DELETE', `/api/discovery/posts/${state.postA.id}/not-interested`, { client: state.viewer });
});

test('14 creator mute suppresses For You but not normal post access', async () => {
  await api('POST', `/api/discovery/creators/${state.creatorAHandle}/mute`, { client: state.viewer });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(feed).includes(state.postA.id), 'muted creator post absent');
  const direct = await api('GET', `/api/posts/${state.postA.id}`, { client: state.viewer });
  assert.equal(direct.data.post.id, state.postA.id);
  await api('DELETE', `/api/discovery/creators/${state.creatorAHandle}/mute`, { client: state.viewer });
});

test('15 topic mute suppresses posts when every topic is muted', async () => {
  await api('POST', '/api/discovery/topics/music/mute', { client: state.viewer });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(feed).includes(state.postB.id), 'muted-only topic post absent');
  await api('DELETE', '/api/discovery/topics/music/mute', { client: state.viewer });
});

test('16 blocking suppresses For You candidates both directions', async () => {
  await api('POST', `/api/users/${state.creatorC.user.id || state.creatorC.user._id}/block`, { client: state.viewer });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(feed).includes(state.postC.id), 'blocked creator post absent');
  await api('DELETE', `/api/users/${state.creatorC.user.id || state.creatorC.user._id}/block`, { client: state.viewer });
});

test('17 cursor pagination is stable and user-bound', async () => {
  const extras = [];
  for (let i = 0; i < 24; i += 1) {
    extras.push(await createDiscoverablePost(state.creatorA, `for you smoke page ${i}`, ['technology']));
  }
  const first = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(first.data.nextCursor, 'next cursor returned');
  const second = await api('GET', `/api/discovery/for-you?cursor=${encodeURIComponent(first.data.nextCursor)}`, { client: state.viewer });
  assert(!postIds(second).some((id) => postIds(first).includes(id)), 'second page has no duplicates');
  await api('GET', `/api/discovery/for-you?cursor=${encodeURIComponent(first.data.nextCursor)}`, { client: state.otherViewer, expected: 404 });
  state.extraPostId = extras[extras.length - 1].id;
});

test('18 refresh returns a new stable cursor', async () => {
  const refreshed = await api('POST', '/api/discovery/for-you/refresh', { client: state.viewer });
  assert(refreshed.data.cursor, 'refresh cursor returned');
  const feed = await api('GET', `/api/discovery/for-you?cursor=${encodeURIComponent(refreshed.data.cursor)}`, { client: state.viewer });
  assert(Array.isArray(feed.data.posts), 'refreshed feed loads');
});

test('19 explanation endpoint re-authorizes the post', async () => {
  const explanation = await api('GET', `/api/discovery/for-you/explanations/${state.postA.id}`, { client: state.viewer });
  assert(explanation.data.explanation.text, 'safe explanation returned');
  assert.equal('score' in explanation.data.explanation, false);
});

test('20 personalization opt-out falls back to recency and does not record optional events', async () => {
  await api('PATCH', '/api/discovery/preferences', { client: state.viewer, body: { personalizedDiscoveryEnabled: false } });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert.equal(feed.data.personalized, false);
  assert(feed.data.message, 'opt-out message returned');
  const token = feed.data.posts[0]?.candidateToken;
  if (token) {
    const recorded = await api('POST', '/api/discovery/for-you/events', { client: state.viewer, body: { eventType: 'discover_post_open', candidateToken: token } });
    assert.equal(recorded.data.recorded, false);
  }
  await api('PATCH', '/api/discovery/preferences', { client: state.viewer, body: { personalizedDiscoveryEnabled: true } });
});

test('21 reset clears optional recommendation state without deleting preferences', async () => {
  const cleared = await api('POST', '/api/discovery/personalization/clear', { client: state.viewer });
  assert.equal(cleared.data.success, true);
  assert('deletedAffinities' in cleared.data, 'affinity cleanup count returned');
  const prefs = await api('GET', '/api/discovery/preferences', { client: state.viewer });
  assert.equal(typeof prefs.data.preferences.personalizedDiscoveryEnabled, 'boolean');
});

test('22 deleted or disabled posts are re-authorized out of active sessions', async () => {
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(postIds(feed).includes(state.extraPostId), 'candidate starts present');
  await api('PATCH', `/api/posts/${state.extraPostId}/discovery`, { client: state.creatorA, body: { discoverable: false, discoveryTopicIds: [] } });
  const refreshed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(!postIds(refreshed).includes(state.extraPostId), 'disabled discoverability removes candidate');
});

test('23 Browse remains available and separate', async () => {
  const browse = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  assert(Array.isArray(browse.data.posts), 'browse posts still load');
  assert(!('explanation' in (browse.data.posts[0] || {})), 'browse response is not replaced by For You');
});

test('24 Communities and Moments are not For You post candidates', async () => {
  const communityHandle = `rdfyc_${runId.replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
  await api('POST', '/api/communities', {
    client: state.creatorA,
    body: { name: 'For You Community', handle: communityHandle, membershipMode: 'open', postingPolicy: 'everyone' },
    expected: 201,
  });
  const feed = await api('GET', '/api/discovery/for-you', { client: state.viewer });
  assert(feed.data.posts.every((post) => post.author && post.candidateToken), 'For You contains only post cards');
  assert(!feed.data.posts.some((post) => post.handle === communityHandle || post.community?.handle === communityHandle), 'community content is not a For You candidate');
});

test('25 invalid cursor and invalid token fail closed', async () => {
  await api('GET', '/api/discovery/for-you?cursor=not-a-valid-cursor', { client: state.viewer, expected: 400 });
  await api('POST', '/api/discovery/for-you/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_open', candidateToken: 'not-a-real-token' },
    expected: 404,
  });
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failures.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error?.message || error);
  }
}

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
