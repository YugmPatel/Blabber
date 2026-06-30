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

async function api(method, path, { client, body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(client?.token ? { authorization: `Bearer ${client.token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    throw new Error(`${method} ${safePath(path.split('?')[0])} returned ${response.status}`);
  }
  safeLog(`  ${method} ${safePath(path.split('?')[0])} -> ${response.status}`);
  return { status: response.status, data, headers: response.headers };
}

async function register(label) {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `reldfeed_${label}_${unique}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-d-feed-${label}-${unique}@example.com`,
      password: 'SmokePass123!',
      name: `Feed ${label}`,
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

async function uploadTinyPng(client) {
  const png = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0,
    9, 251, 3, 253, 160, 111, 147, 91, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130,
  ]);
  const presign = await api('POST', '/api/media/presign', {
    client,
    body: { fileName: 'feed.png', fileType: 'image/png', fileSize: png.length },
  });
  const uploadResponse = await fetch(presign.data.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${client.token}`, 'content-type': 'image/png' },
    body: png,
  });
  assert.equal(uploadResponse.status, 200, 'photo upload approved');
  const uploaded = await uploadResponse.json();
  return uploaded.mediaId;
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 users and profiles are prepared', async () => {
  state.suffix = Math.random().toString(36).slice(2, 8);
  state.owner = await register('owner');
  state.follower = await register('follower');
  state.stranger = await register('stranger');
  state.blocked = await register('blocked');
  state.ownerHandle = `reldfeed_${state.suffix}_owner`;
  state.followerHandle = `reldfeed_${state.suffix}_follower`;
  state.strangerHandle = `reldfeed_${state.suffix}_stranger`;
  state.blockedHandle = `reldfeed_${state.suffix}_blocked`;
  await setHandle(state.owner, state.ownerHandle);
  await setHandle(state.follower, state.followerHandle);
  await setHandle(state.stranger, state.strangerHandle);
  await setHandle(state.blocked, state.blockedHandle);
  await updateProfile(state.owner, { visibility: 'public', bio: 'feed profile' });
});

test('03 public text post creates and appears in author feed', async () => {
  const created = await api('POST', '/api/posts', {
    client: state.owner,
    body: { body: 'release d public post smoke', visibility: 'public' },
    expected: 201,
  });
  state.publicPost = created.data.post;
  assert.equal(created.data.post.visibility, 'public');
  const feed = await api('GET', '/api/feed', { client: state.owner });
  assert(feed.data.posts.some((post) => post.id === state.publicPost.id), 'author feed includes own post');
});

test('04 public post is readable by authenticated stranger but not in stranger following feed', async () => {
  const post = await api('GET', `/api/posts/${state.publicPost.id}`, { client: state.stranger });
  assert.equal(post.data.post.id, state.publicPost.id);
  const feed = await api('GET', '/api/feed', { client: state.stranger });
  assert(!feed.data.posts.some((post) => post.id === state.publicPost.id), 'not-following feed omits public post');
});

test('05 follow makes author posts appear in chronological feed', async () => {
  await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.follower });
  const feed = await api('GET', '/api/feed', { client: state.follower });
  assert(feed.data.posts.some((post) => post.id === state.publicPost.id), 'following feed includes followed author post');
});

test('06 photo post accepts only approved owner image media', async () => {
  state.mediaId = await uploadTinyPng(state.owner);
  const created = await api('POST', '/api/posts', {
    client: state.owner,
    body: { body: 'release d photo post smoke', visibility: 'public', mediaIds: [state.mediaId] },
    expected: 201,
  });
  state.photoPost = created.data.post;
  assert.equal(created.data.post.media.length, 1);
  await api('POST', '/api/posts', {
    client: state.follower,
    body: { visibility: 'followers', mediaIds: [state.mediaId] },
    expected: 400,
  });
});

test('07 post media is authorized through post route and generic media URL is hidden', async () => {
  const media = await api('GET', `/api/posts/${state.photoPost.id}/media/${state.mediaId}`, { client: state.follower });
  assert.equal(media.headers.get('content-type'), 'image/png');
  await api('GET', `/api/media/local/${state.mediaId}`, { client: state.follower, expected: 404 });
});

test('08 private profile forces followers visibility and hides from nonfollowers', async () => {
  await updateProfile(state.owner, { visibility: 'private' });
  const created = await api('POST', '/api/posts', {
    client: state.owner,
    body: { body: 'release d private profile post smoke', visibility: 'public' },
    expected: 201,
  });
  state.followersPost = created.data.post;
  assert.equal(created.data.post.visibility, 'followers');
  await api('GET', `/api/posts/${state.followersPost.id}`, { client: state.stranger, expected: 404 });
  const visible = await api('GET', `/api/posts/${state.followersPost.id}`, { client: state.follower });
  assert.equal(visible.data.post.id, state.followersPost.id);
});

test('09 profile post list respects authorization', async () => {
  const followerPosts = await api('GET', `/api/profiles/${state.ownerHandle}/posts`, { client: state.follower });
  assert(followerPosts.data.posts.some((post) => post.id === state.followersPost.id), 'follower can list profile post');
  const strangerPosts = await api('GET', `/api/profiles/${state.ownerHandle}/posts`, { client: state.stranger });
  assert(!strangerPosts.data.posts.some((post) => post.id === state.followersPost.id), 'stranger cannot list followers post');
});

test('10 reactions expose aggregate counts and viewer reaction only', async () => {
  const reacted = await api('POST', `/api/posts/${state.publicPost.id}/reaction`, {
    client: state.follower,
    body: { emoji: '🙌' },
  });
  assert.equal(reacted.data.myReaction, '🙌');
  assert.equal(reacted.data.reactionCounts['🙌'], 1);
  await api('POST', `/api/posts/${state.publicPost.id}/reaction`, { client: state.follower, body: { emoji: '🔥' }, expected: 400 });
  const post = await api('GET', `/api/posts/${state.publicPost.id}`, { client: state.follower });
  assert(!post.data.post.reactions, 'reaction identities are not exposed');
});

test('11 removing reaction sends no remaining viewer reaction', async () => {
  const removed = await api('DELETE', `/api/posts/${state.publicPost.id}/reaction`, { client: state.follower });
  assert.equal(removed.data.myReaction, null);
  assert.equal(removed.data.reactionCounts['🙌'] || 0, 0);
});

test('12 comments are flat and expose safe author identity', async () => {
  const created = await api('POST', `/api/posts/${state.publicPost.id}/comments`, {
    client: state.follower,
    body: { body: 'release d comment smoke' },
    expected: 201,
  });
  state.comment = created.data.comment;
  const comments = await api('GET', `/api/posts/${state.publicPost.id}/comments`, { client: state.owner });
  assert(comments.data.comments.some((comment) => comment.id === state.comment.id), 'comment is listed');
  assert(!comments.data.comments[0].author.email, 'commenter email is not exposed');
});

test('13 post owner can moderate comments', async () => {
  const deleted = await api('DELETE', `/api/posts/${state.publicPost.id}/comments/${state.comment.id}`, { client: state.owner });
  assert.equal(deleted.data.commentCount, 0);
  const comments = await api('GET', `/api/posts/${state.publicPost.id}/comments`, { client: state.owner });
  assert(!comments.data.comments.some((comment) => comment.id === state.comment.id), 'deleted comment is hidden');
});

test('14 reports accept post and post comment targets with authorization', async () => {
  const comment = await api('POST', `/api/posts/${state.publicPost.id}/comments`, {
    client: state.follower,
    body: { body: 'release d report comment smoke' },
    expected: 201,
  });
  await api('POST', `/api/posts/${state.publicPost.id}/report`, {
    client: state.follower,
    body: { reason: 'Spam or abuse' },
    expected: 201,
  });
  await api('POST', `/api/posts/${state.publicPost.id}/comments/${comment.data.comment.id}/report`, {
    client: state.follower,
    body: { reason: 'Spam or abuse' },
    expected: 201,
  });
  await api('POST', `/api/posts/${state.followersPost.id}/report`, {
    client: state.stranger,
    body: { reason: 'Spam or abuse' },
    expected: 404,
  });
});

test('15 post notification preference is exposed and mutable', async () => {
  const prefs = await api('GET', `/api/notifications/preferences/${state.owner.user._id}`, { client: state.owner });
  assert.equal(prefs.data.preferences.postActivityEnabled, true);
  const updated = await api('PATCH', `/api/notifications/preferences/${state.owner.user._id}`, {
    client: state.owner,
    body: { postActivityEnabled: false },
  });
  assert.equal(updated.data.preferences.postActivityEnabled, false);
});

test('16 block and deletion remove posts from accessible feeds and search remains message-only', async () => {
  await api('POST', `/api/users/${state.blocked.user._id}/block`, { client: state.owner });
  await api('GET', `/api/posts/${state.publicPost.id}`, { client: state.blocked, expected: 404 });
  await api('DELETE', `/api/posts/${state.publicPost.id}`, { client: state.owner });
  await api('GET', `/api/posts/${state.publicPost.id}`, { client: state.follower, expected: 404 });
  const search = await api('GET', `/api/messages/search/global?q=${encodeURIComponent('release d public post smoke')}`, { client: state.owner });
  const results = search.data.messages || search.data.results || [];
  assert.equal(results.length, 0, 'post bodies are absent from message search');
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
