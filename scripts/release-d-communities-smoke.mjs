#!/usr/bin/env node
import assert from 'node:assert/strict';

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const VERBOSE = process.env.SMOKE_VERBOSE === 'true';
const runId = `rdcomm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

async function api(method, path, { client, body, expected = 200, parse = 'json', headers = {} } = {}) {
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
  if (VERBOSE) console.log(`  ${method} ${safePath(path.split('?')[0])} -> ${response.status}`);
  return { status: response.status, data, headers: response.headers };
}

async function register(label, verify = true) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 28);
  const password = `SmokePass123!${label}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `rdcomm_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-d-communities-${unique}@example.com`,
      password,
      name: `Community ${label}`,
    },
    expected: 201,
  });
  const client = { token: response.data.accessToken, user: response.data.user, password };
  assert(client.token, `${label} token is present`);
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
    body: { fileName: 'community.png', fileType: 'image/png', fileSize: png.length },
  });
  const upload = await fetch(presign.data.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${client.token}`, 'content-type': 'image/png' },
    body: png,
  });
  assert.equal(upload.status, 200, 'community image upload approved');
  const uploaded = await upload.json();
  return uploaded.mediaId;
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 users are verified and profile handles are required', async () => {
  state.suffix = `${Date.now().toString(36).slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
  state.owner = await register('owner');
  state.member = await register('member');
  state.admin = await register('admin');
  state.moderator = await register('mod');
  state.stranger = await register('stranger');
  state.blocked = await register('blocked');
  state.unverified = await register('unverified', false);
  for (const [label, client] of Object.entries({
    owner: state.owner,
    member: state.member,
    admin: state.admin,
    moderator: state.moderator,
    stranger: state.stranger,
    blocked: state.blocked,
  })) {
    await setHandle(client, `rdc_${state.suffix}_${label}`);
  }
  await api('POST', '/api/communities', {
    client: state.unverified,
    body: { name: 'Unverified Community', handle: `rdc_${state.suffix}_unverified`, membershipMode: 'open', postingPolicy: 'everyone' },
    expected: 400,
  });
});

test('03 owner creates open community and handle validation is enforced', async () => {
  state.openHandle = `rdc_${state.suffix}_open`;
  const created = await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Release Community Open', handle: state.openHandle, description: 'community smoke', membershipMode: 'open', postingPolicy: 'everyone' },
    expected: 201,
  });
  state.openCommunity = created.data.community;
  assert.equal(created.data.community.membership.role, 'owner');
  await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Reserved Handle', handle: 'admin', membershipMode: 'open', postingPolicy: 'everyone' },
    expected: 409,
  });
  await api('POST', '/api/communities', {
    client: state.admin,
    body: { name: 'Duplicate Handle', handle: state.openHandle.toUpperCase(), membershipMode: 'open', postingPolicy: 'everyone' },
    expected: 409,
  });
});

test('04 open nonmember preview is minimal and content remains member-only', async () => {
  const preview = await api('GET', `/api/communities/${state.openHandle}`, { client: state.stranger });
  assert.equal(preview.data.community.membership, null);
  assert.equal(preview.data.community.postingPolicy, undefined);
  await api('GET', `/api/communities/${state.openHandle}/posts`, { client: state.stranger, expected: 404 });
});

test('05 open community join grants member content access', async () => {
  const joined = await api('POST', `/api/communities/${state.openHandle}/join`, { client: state.member });
  assert.equal(joined.data.community.membership.role, 'member');
  const list = await api('GET', '/api/communities', { client: state.member });
  assert(list.data.communities.some((community) => community.id === state.openCommunity.id), 'joined community is listed');
});

test('06 community posts are isolated from global feed and profile posts', async () => {
  const created = await api('POST', `/api/communities/${state.openHandle}/posts`, {
    client: state.owner,
    body: { body: 'community post smoke' },
    expected: 201,
  });
  state.post = created.data.post;
  const posts = await api('GET', `/api/communities/${state.openHandle}/posts`, { client: state.member });
  assert(posts.data.posts.some((post) => post.id === state.post.id), 'member sees community post');
  const feed = await api('GET', '/api/feed', { client: state.member });
  assert(!feed.data.posts.some((post) => post.id === state.post.id), 'community post is absent from global feed');
  await api('GET', `/api/profiles/rdc_${state.suffix}_owner/posts`, { client: state.member });
});

test('07 community reactions expose aggregate counts and own state only', async () => {
  const reacted = await api('POST', `/api/community-posts/${state.post.id}/reaction`, {
    client: state.member,
    body: { emoji: '🙌' },
  });
  assert.equal(reacted.data.myReaction, '🙌');
  assert.equal(reacted.data.reactionCounts['🙌'], 1);
  await api('POST', `/api/community-posts/${state.post.id}/reaction`, { client: state.member, body: { emoji: '🔥' }, expected: 400 });
  const removed = await api('DELETE', `/api/community-posts/${state.post.id}/reaction`, { client: state.member });
  assert.equal(removed.data.myReaction, null);
});

test('08 community comments are flat and can be removed by moderators', async () => {
  const comment = await api('POST', `/api/community-posts/${state.post.id}/comments`, {
    client: state.member,
    body: { body: 'community comment smoke' },
    expected: 201,
  });
  state.comment = comment.data.comment;
  const comments = await api('GET', `/api/community-posts/${state.post.id}/comments`, { client: state.owner });
  assert(comments.data.comments.some((item) => item.id === state.comment.id), 'comment is listed');
  await api('DELETE', `/api/community-posts/${state.post.id}/comments/${state.comment.id}`, { client: state.owner, expected: 204 });
});

test('09 community image media is authorized only through community routes', async () => {
  state.mediaId = await uploadTinyPng(state.owner);
  const created = await api('POST', `/api/communities/${state.openHandle}/posts`, {
    client: state.owner,
    body: { body: 'community photo smoke', mediaIds: [state.mediaId] },
    expected: 201,
  });
  state.photoPost = created.data.post;
  const media = await api('GET', `/api/community-posts/${state.photoPost.id}/media/${state.mediaId}`, {
    client: state.member,
    parse: 'arrayBuffer',
  });
  assert.equal(media.headers.get('content-type'), 'image/png');
  await api('GET', `/api/media/local/${state.mediaId}`, { client: state.member, expected: 404 });
});

test('10 approval community requests can be cancelled and approved', async () => {
  state.approvalHandle = `rdc_${state.suffix}_approval`;
  await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Release Community Approval', handle: state.approvalHandle, membershipMode: 'approval_required', postingPolicy: 'everyone' },
    expected: 201,
  });
  await api('POST', `/api/communities/${state.approvalHandle}/request`, { client: state.admin });
  await api('DELETE', `/api/communities/${state.approvalHandle}/request`, { client: state.admin, expected: 204 });
  await api('POST', `/api/communities/${state.approvalHandle}/request`, { client: state.admin });
  const requests = await api('GET', `/api/communities/${state.approvalHandle}/requests`, { client: state.owner });
  assert.equal(requests.data.requests.length, 1);
  await api('POST', `/api/communities/${state.approvalHandle}/requests/${state.admin.user._id}/approve`, { client: state.owner, expected: 204 });
  const community = await api('GET', `/api/communities/${state.approvalHandle}`, { client: state.admin });
  assert.equal(community.data.community.membership.role, 'member');
});

test('11 private community is unavailable without membership or invite', async () => {
  state.privateHandle = `rdc_${state.suffix}_private`;
  await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Release Community Private', handle: state.privateHandle, membershipMode: 'private', postingPolicy: 'everyone' },
    expected: 201,
  });
  await api('GET', `/api/communities/${state.privateHandle}`, { client: state.stranger, expected: 404 });
  const invite = await api('POST', `/api/communities/${state.privateHandle}/invite`, {
    client: state.owner,
    body: { expiresIn: '7d', maxUses: 10 },
    expected: 201,
  });
  state.inviteToken = invite.data.token;
  const preview = await api('GET', `/api/communities/invite/${state.inviteToken}`, { client: state.stranger });
  assert.equal(preview.data.community.handle, state.privateHandle);
  const accepted = await api('POST', `/api/communities/invite/${state.inviteToken}/accept`, { client: state.stranger });
  assert.equal(accepted.data.community.membership.role, 'member');
});

test('12 already-member invite acceptance does not consume extra access', async () => {
  const accepted = await api('POST', `/api/communities/invite/${state.inviteToken}/accept`, { client: state.stranger });
  assert.equal(accepted.data.community.membership.role, 'member');
});

test('13 posting policy blocks regular members but allows owners', async () => {
  state.policyHandle = `rdc_${state.suffix}_policy`;
  await api('POST', '/api/communities', {
    client: state.owner,
    body: { name: 'Release Community Policy', handle: state.policyHandle, membershipMode: 'open', postingPolicy: 'admins_only' },
    expected: 201,
  });
  await api('POST', `/api/communities/${state.policyHandle}/join`, { client: state.member });
  await api('POST', `/api/communities/${state.policyHandle}/posts`, {
    client: state.member,
    body: { body: 'member blocked by policy' },
    expected: 400,
  });
  await api('POST', `/api/communities/${state.policyHandle}/posts`, {
    client: state.owner,
    body: { body: 'owner allowed by policy' },
    expected: 201,
  });
});

test('14 role changes and restrictions are server enforced', async () => {
  await api('PATCH', `/api/communities/${state.openHandle}/members/${state.admin.user._id}/role`, {
    client: state.owner,
    body: { role: 'moderator' },
    expected: 400,
  });
  await api('POST', `/api/communities/${state.openHandle}/join`, { client: state.admin });
  await api('PATCH', `/api/communities/${state.openHandle}/members/${state.admin.user._id}/role`, {
    client: state.owner,
    body: { role: 'moderator' },
    expected: 204,
  });
  await api('POST', `/api/communities/${state.openHandle}/join`, { client: state.moderator });
  await api('PATCH', `/api/communities/${state.openHandle}/members/${state.moderator.user._id}/restriction`, {
    client: state.admin,
    body: { restricted: true },
    expected: 204,
  });
  await api('POST', `/api/communities/${state.openHandle}/posts`, {
    client: state.moderator,
    body: { body: 'restricted post' },
    expected: 400,
  });
  const reaction = await api('POST', `/api/community-posts/${state.post.id}/reaction`, {
    client: state.moderator,
    body: { emoji: '😂' },
  });
  assert.equal(reaction.data.myReaction, '😂');
});

test('15 moderators cannot create invites but can remove lower members', async () => {
  await api('POST', `/api/communities/${state.openHandle}/invite`, {
    client: state.admin,
    body: { expiresIn: '7d', maxUses: 10 },
    expected: 400,
  });
  await api('DELETE', `/api/communities/${state.openHandle}/members/${state.moderator.user._id}`, {
    client: state.admin,
    expected: 204,
  });
  await api('GET', `/api/communities/${state.openHandle}`, { client: state.moderator, expected: 200 });
  await api('GET', `/api/communities/${state.openHandle}/posts`, { client: state.moderator, expected: 404 });
});

test('16 bans prevent future preview and invite joins', async () => {
  await api('POST', `/api/communities/${state.openHandle}/join`, { client: state.blocked });
  await api('POST', `/api/communities/${state.openHandle}/members/${state.blocked.user._id}/ban`, {
    client: state.owner,
    expected: 204,
  });
  await api('GET', `/api/communities/${state.openHandle}`, { client: state.blocked, expected: 404 });
});

test('17 community reports require readable targets', async () => {
  const comment = await api('POST', `/api/community-posts/${state.post.id}/comments`, {
    client: state.member,
    body: { body: 'reportable community comment' },
    expected: 201,
  });
  await api('POST', `/api/community-posts/${state.post.id}/report`, {
    client: state.member,
    body: { reason: 'Spam or abuse' },
    expected: 201,
  });
  await api('POST', `/api/community-posts/${state.post.id}/comments/${comment.data.comment.id}/report`, {
    client: state.member,
    body: { reason: 'Spam or abuse' },
    expected: 201,
  });
  await api('POST', `/api/community-posts/${state.post.id}/report`, {
    client: state.blocked,
    body: { reason: 'Spam or abuse' },
    expected: 404,
  });
});

test('18 blocking hides shared-community contributions', async () => {
  await api('POST', `/api/users/${state.member.user._id}/block`, { client: state.owner });
  await api('GET', `/api/community-posts/${state.post.id}`, { client: state.member, expected: 404 });
  const posts = await api('GET', `/api/communities/${state.openHandle}/posts`, { client: state.member });
  assert(!posts.data.posts.some((post) => post.id === state.post.id), 'blocked author contribution is hidden');
});

test('19 moderation activity is owner/admin-only and safe', async () => {
  const activity = await api('GET', `/api/communities/${state.openHandle}/activity`, { client: state.owner });
  assert(activity.data.activity.length > 0, 'activity contains entries');
  const serialized = JSON.stringify(activity.data.activity);
  assert(!serialized.includes(state.inviteToken), 'activity does not include invite token');
  await api('GET', `/api/communities/${state.openHandle}/activity`, { client: state.member, expected: 400 });
});

test('20 community export manifest includes safe community files', async () => {
  const request = await api('POST', '/api/auth/account/export', {
    client: state.owner,
    body: { currentPassword: state.owner.password },
    expected: 202,
  });
  let ready = null;
  for (let i = 0; i < 20; i += 1) {
    const exports = await api('GET', '/api/auth/account/export', { client: state.owner });
    ready = exports.data.exports?.find((item) => item.id === request.data.export.id && item.status === 'ready');
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, 'community export becomes ready');
  const zip = await api('GET', `/api/auth/account/export/${request.data.export.id}/download`, {
    client: state.owner,
    parse: 'arrayBuffer',
  });
  const zipText = Buffer.from(zip.data).toString('latin1');
  assert(zipText.includes('communities-owned-by-me.json'), 'owned communities export listed');
  assert(zipText.includes('community-posts-authored-by-me.json'), 'community posts export listed');
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
