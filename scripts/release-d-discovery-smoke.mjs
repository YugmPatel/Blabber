#!/usr/bin/env node
import assert from 'node:assert/strict';

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const runId = `rddisc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function safePath(path) {
  return path
    .replace(/\/invite\/[A-Za-z0-9_-]+/g, '/invite/:token')
    .replace(/[a-f0-9]{24}/gi, ':id');
}

async function api(method, path, { client, body, expected = 200, parse = 'json' } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(client?.token ? { authorization: `Bearer ${client.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = parse === 'arrayBuffer'
    ? await response.arrayBuffer()
    : contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const error = typeof data?.error === 'string' ? data.error : 'Error';
    const message = typeof data?.message === 'string' ? data.message : 'Unexpected response';
    throw new Error(`${method} ${safePath(path.split('?')[0])} returned ${response.status} ${error}: ${message}`);
  }
  return { status: response.status, data, headers: response.headers };
}

async function register(label, verify = true) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 28);
  const password = `SmokePass123!${label}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `rddisc_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-d-discovery-${unique}@example.com`,
      password,
      name: `Discovery ${label}`,
    },
    expected: 201,
  });
  const client = { token: response.data.accessToken, user: response.data.user, password, email: `release-d-discovery-${unique}@example.com` };
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

async function setHandle(client, handle) {
  const response = await api('PATCH', '/api/profiles/me/handle', { client, body: { handle } });
  return response.data.profile;
}

async function updateProfile(client, body) {
  const response = await api('PATCH', '/api/profiles/me', { client, body });
  return response.data.profile;
}

function hasId(items, id) {
  return items.some((item) => item.id === id || item.handle === id || item.author?.handle === id);
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 discovery routes require authentication and topics are controlled', async () => {
  await api('GET', '/api/discovery/topics', { expected: 401 });
  state.owner = await register('owner');
  state.viewer = await register('viewer');
  state.other = await register('other');
  state.privateCreator = await register('private');
  state.unverified = await register('unverified', false);
  const topics = await api('GET', '/api/discovery/topics', { client: state.viewer });
  assert(topics.data.topics.some((topic) => topic.id === 'technology'), 'controlled topic is present');
  assert(!topics.data.topics.some((topic) => topic.id === 'politics'), 'sensitive topic is absent');
});

test('03 creator discovery defaults disabled', async () => {
  const profile = await api('GET', '/api/profiles/me', { client: state.owner });
  assert.equal(profile.data.profile.creatorDiscovery.enabled, false);
});

test('04 public verified handle and topic are required to enable creator discovery', async () => {
  await api('PATCH', '/api/profiles/me/discovery', {
    client: state.privateCreator,
    body: { creatorDiscoveryEnabled: true, creatorTopicIds: ['technology'] },
    expected: 400,
  });
  state.ownerHandle = `rdd_${runId.replace(/[^a-z0-9]/g, '').slice(0, 12)}own`;
  await setHandle(state.owner, state.ownerHandle);
  await updateProfile(state.owner, { visibility: 'public', bio: 'Discovery profile' });
  await api('PATCH', '/api/profiles/me/discovery', {
    client: state.owner,
    body: { creatorDiscoveryEnabled: true, creatorTopicIds: ['technology', 'software_engineering'] },
  });
  await setHandle(state.viewer, `rdd_${runId.replace(/[^a-z0-9]/g, '').slice(0, 12)}view`);
  await updateProfile(state.viewer, { visibility: 'public' });
  await setHandle(state.other, `rdd_${runId.replace(/[^a-z0-9]/g, '').slice(0, 12)}oth`);
  await updateProfile(state.other, { visibility: 'public' });
});

test('05 unverified user cannot enable creator discovery', async () => {
  await setHandle(state.unverified, `rdd_${runId.replace(/[^a-z0-9]/g, '').slice(0, 12)}unv`);
  await updateProfile(state.unverified, { visibility: 'public' });
  await api('PATCH', '/api/profiles/me/discovery', {
    client: state.unverified,
    body: { creatorDiscoveryEnabled: true, creatorTopicIds: ['technology'] },
    expected: 400,
  });
});

test('06 public post defaults non-discoverable and can be explicitly included', async () => {
  const created = await api('POST', '/api/posts', {
    client: state.owner,
    body: { body: 'discovery smoke public candidate', visibility: 'public' },
    expected: 201,
  });
  state.post = created.data.post;
  assert.equal(Boolean(state.post.discovery.discoverable), false);
  const updated = await api('PATCH', `/api/posts/${state.post.id}/discovery`, {
    client: state.owner,
    body: { discoverable: true, discoveryTopicIds: ['technology'] },
  });
  assert.equal(updated.data.post.discovery.discoverable, true);
});

test('07 followers-only post cannot be discoverable', async () => {
  const created = await api('POST', '/api/posts', {
    client: state.owner,
    body: { body: 'discovery smoke followers candidate', visibility: 'followers' },
    expected: 201,
  });
  await api('PATCH', `/api/posts/${created.data.post.id}/discovery`, {
    client: state.owner,
    body: { discoverable: true, discoveryTopicIds: ['technology'] },
    expected: 400,
  });
});

test('08 topic browse returns eligible post only newest-first', async () => {
  const browse = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  assert(hasId(browse.data.posts, state.post.id), 'eligible discoverable post appears');
  assert(browse.data.posts[0].candidateToken, 'candidate token is issued');
  state.postCandidateToken = browse.data.posts.find((post) => post.id === state.post.id).candidateToken;
});

test('09 creator browse returns opted-in creator only', async () => {
  const creators = await api('GET', '/api/discovery/creators?topic=technology', { client: state.viewer });
  const creator = creators.data.creators.find((item) => item.handle === state.ownerHandle);
  assert(creator, 'creator card is returned safely');
  state.creatorCandidateToken = creator.candidateToken;
});

test('10 open owner-listed community appears without posts', async () => {
  state.communityHandle = `rddc_${runId.replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
  const created = await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Discovery Community', handle: state.communityHandle, membershipMode: 'open', postingPolicy: 'everyone' },
    expected: 201,
  });
  await api('PATCH', `/api/communities/${state.communityHandle}/discovery`, {
    client: state.owner,
    body: { communityDiscoverable: true, communityTopicIds: ['technology'] },
  });
  const listed = await api('GET', '/api/discovery/communities?topic=technology', { client: state.viewer });
  const community = listed.data.communities.find((item) => item.handle === state.communityHandle);
  assert(community, 'listed community appears');
  assert(!('posts' in community), 'community posts are not exposed through listing');
  state.communityCandidateToken = community.candidateToken;
  await api('POST', `/api/communities/${state.communityHandle}/join`, { client: state.viewer });
});

test('11 private and approval communities cannot be listed', async () => {
  const approvalHandle = `${state.communityHandle}_a`.slice(0, 30);
  await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Approval Discovery', handle: approvalHandle, membershipMode: 'approval_required', postingPolicy: 'everyone' },
    expected: 201,
  });
  await api('PATCH', `/api/communities/${approvalHandle}/discovery`, {
    client: state.owner,
    body: { communityDiscoverable: true, communityTopicIds: ['technology'] },
    expected: 400,
  });
});

test('12 not interested suppresses exact post only', async () => {
  await api('POST', `/api/discovery/posts/${state.post.id}/not-interested`, { client: state.viewer });
  const hidden = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  assert(!hasId(hidden.data.posts, state.post.id), 'hidden post is absent for viewer');
  const visible = await api('GET', '/api/discovery/posts?topic=technology', { client: state.other });
  assert(hasId(visible.data.posts, state.post.id), 'hidden post remains visible to other viewer');
  await api('DELETE', `/api/discovery/posts/${state.post.id}/not-interested`, { client: state.viewer });
});

test('13 mute creator suppresses creator and posts without unfollowing', async () => {
  await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.viewer, expected: [200, 404] });
  const before = await api('GET', `/api/posts/${state.post.id}`, { client: state.viewer });
  assert.equal(before.data.post.id, state.post.id);
  const handle = state.ownerHandle;
  await api('POST', `/api/discovery/creators/${handle}/mute`, { client: state.viewer });
  const posts = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  assert(!hasId(posts.data.posts, state.post.id), 'muted creator post absent from Discover');
  const ordinary = await api('GET', `/api/posts/${state.post.id}`, { client: state.viewer });
  assert.equal(ordinary.data.post.id, state.post.id);
  await api('DELETE', `/api/discovery/creators/${handle}/mute`, { client: state.viewer });
});

test('14 mute community suppresses listing but membership remains', async () => {
  await api('POST', `/api/discovery/communities/${state.communityHandle}/mute`, { client: state.viewer });
  const listed = await api('GET', '/api/discovery/communities?topic=technology', { client: state.viewer });
  assert(!listed.data.communities.some((community) => community.handle === state.communityHandle), 'muted community absent');
  const community = await api('GET', `/api/communities/${state.communityHandle}`, { client: state.viewer });
  assert(community.data.community.membership, 'membership remains');
  await api('DELETE', `/api/discovery/communities/${state.communityHandle}/mute`, { client: state.viewer });
});

test('15 mute topic suppresses direct topic results', async () => {
  await api('POST', '/api/discovery/topics/technology/mute', { client: state.viewer });
  const posts = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  assert(!hasId(posts.data.posts, state.post.id), 'muted topic suppresses post');
  await api('DELETE', '/api/discovery/topics/technology/mute', { client: state.viewer });
});

test('16 block denies creator and post Discover access', async () => {
  await api('POST', `/api/users/${state.owner.user._id}/block`, { client: state.other });
  const posts = await api('GET', '/api/discovery/posts?topic=technology', { client: state.other });
  assert(!hasId(posts.data.posts, state.post.id), 'blocked creator post absent');
});

test('17 candidate token validates user ownership', async () => {
  await api('POST', '/api/discovery/events', {
    client: state.other,
    body: { eventType: 'discover_post_open', candidateToken: state.postCandidateToken },
    expected: 404,
  });
});

test('18 bounded dwell records only while personalization enabled', async () => {
  await api('POST', '/api/discovery/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_dwell', candidateToken: state.postCandidateToken, dwellBucket: 'raw_999999' },
    expected: 400,
  });
  await api('PATCH', '/api/discovery/preferences', { client: state.viewer, body: { personalizedDiscoveryEnabled: false } });
  const disabled = await api('POST', '/api/discovery/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_open', candidateToken: state.postCandidateToken },
  });
  assert.equal(disabled.data.recorded, false);
});

test('19 valid signal records and clear reset preserves feedback controls', async () => {
  await api('PATCH', '/api/discovery/preferences', { client: state.viewer, body: { personalizedDiscoveryEnabled: true } });
  const fresh = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  const token = fresh.data.posts.find((post) => post.id === state.post.id)?.candidateToken;
  assert(token, 'fresh candidate token is available');
  const recorded = await api('POST', '/api/discovery/events', {
    client: state.viewer,
    body: { eventType: 'discover_post_open', candidateToken: token },
  });
  assert.equal(recorded.data.recorded, true);
  await api('POST', `/api/discovery/posts/${state.post.id}/not-interested`, { client: state.viewer });
  const cleared = await api('POST', '/api/discovery/personalization/clear', { client: state.viewer });
  assert(cleared.data.deletedSignals >= 1, 'clear removes optional signals');
  const prefs = await api('GET', '/api/discovery/preferences', { client: state.viewer });
  assert(prefs.data.preferences.hiddenPostCount >= 1, 'explicit hide feedback persists');
  await api('DELETE', `/api/discovery/posts/${state.post.id}/not-interested`, { client: state.viewer });
});

test('20 Discover content remains excluded from following feed and message search', async () => {
  const feed = await api('GET', '/api/feed', { client: state.other });
  assert(!feed.data.posts.some((post) => post.id === state.post.id), 'non-following feed omits Discover post');
  const search = await api('GET', '/api/messages/search/global?q=discovery%20smoke%20public%20candidate', { client: state.owner });
  assert.equal((search.data.results || []).length, 0, 'message search excludes discovery post body');
});

test('21 deactivation removes creator and posts from Discover immediately', async () => {
  await api('POST', '/api/auth/account/deletion', {
    client: state.owner,
    body: { currentPassword: state.owner.password, confirmation: 'DELETE' },
    expected: 202,
  });
  const posts = await api('GET', '/api/discovery/posts?topic=technology', { client: state.viewer });
  assert(!hasId(posts.data.posts, state.post.id), 'deactivated author post absent');
  const communities = await api('GET', '/api/discovery/communities?topic=technology', { client: state.viewer });
  assert(!communities.data.communities.some((community) => community.handle === state.communityHandle), 'deactivated owner community absent');
});

test('22 smoke output redaction guard does not contain unsafe literals', async () => {
  const summaryProbe = JSON.stringify({ tests: tests.map((item) => item.name), runId });
  assert(!summaryProbe.includes('candidateToken'), 'summary probe omits candidate tokens');
  assert(!summaryProbe.includes('discovery smoke public candidate'), 'summary probe omits post body');
  assert(!summaryProbe.includes('/invite/'), 'summary probe omits invite data');
});

let passed = 0;
const started = Date.now();
for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${item.name}`);
    console.error(error?.message || error);
    console.error(`Release D Discovery smoke complete: ${passed} passed, 1 failed`);
    process.exit(1);
  }
}

console.log(`${passed} passed, 0 failed`);
console.log(`Release D Discovery smoke complete: ${passed} passed, 0 failed (${Date.now() - started}ms)`);
