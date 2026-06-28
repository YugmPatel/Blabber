#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const VERBOSE = process.env.SMOKE_VERBOSE === 'true';
const execFileAsync = promisify(execFile);
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
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
    throw new Error(`${method} ${path.split('?')[0].replace(/[a-f0-9]{24}/gi, ':id')} returned ${response.status}`);
  }
  safeLog(`  ${method} ${path.replace(/[a-f0-9]{24}/gi, ':id')} -> ${response.status}`);
  return { status: response.status, data, headers: response.headers };
}

async function register(label) {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `release-c-moments-${label}-${unique}@example.com`;
  const password = 'SmokePass123!';
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `moments_${label}_${unique}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email,
      password,
      name: `Moments ${label}`,
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

async function expireMomentInDocker(momentId) {
  const script = `
const { MongoClient, ObjectId } = require('mongodb');
(async () => {
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  const db = mongo.db(process.env.MONGO_DB_NAME);
  await db.collection('moments').updateOne(
    { _id: new ObjectId(process.env.MOMENT_ID) },
    { $set: { expiresAt: new Date(Date.now() - 60000) } }
  );
  await mongo.close();
})().catch((error) => { console.error(error.message); process.exit(1); });
`;
  await execFileAsync('docker', ['exec', '-e', `MOMENT_ID=${momentId}`, 'blabber-full-users', 'node', '-e', script], {
    maxBuffer: 1024 * 1024,
  });
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
    body: { fileName: 'moment.png', fileType: 'image/png', fileSize: png.length },
    expected: 200,
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

test('02 users and direct contacts are prepared', async () => {
  state.owner = await register('owner');
  state.viewer = await register('viewer');
  state.other = await register('other');
  state.blocked = await register('blocked');
  state.directChat = await createDirect(state.owner, state.viewer.user._id);
  await createDirect(state.owner, state.other.user._id);
  await createDirect(state.owner, state.blocked.user._id);
  const contacts = await api('GET', '/api/moments/contacts', { client: state.owner });
  assert(contacts.data.contacts.length >= 3, 'contacts include direct chat contacts');
});

test('03 text Moment can be created for contacts', async () => {
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'private moment body', style: { backgroundKey: 'teal' }, audienceType: 'contacts' },
    expected: 201,
  });
  state.textMoment = created.data.moment;
  assert.equal(created.data.moment.type, 'text');
  assert(!created.data.moment.audienceSnapshotUserIds, 'audience snapshot is not exposed');
});

test('04 viewer sees and marks Moment viewed', async () => {
  const feed = await api('GET', '/api/moments/feed', { client: state.viewer });
  assert(feed.data.recentMoments.some((moment) => moment._id === state.textMoment._id), 'viewer sees recent Moment');
  await api('POST', `/api/moments/${state.textMoment._id}/view`, { client: state.viewer });
  const viewed = await api('GET', '/api/moments/feed', { client: state.viewer });
  assert(viewed.data.viewedMoments.some((moment) => moment._id === state.textMoment._id), 'viewer sees viewed Moment');
});

test('05 Moment viewers are author-only and do not expose private IDs', async () => {
  const denied = await api('GET', `/api/moments/${state.textMoment._id}/viewers`, { client: state.viewer, expected: 404 });
  assert(denied.data.message.includes('Moment'), 'non-author denied');
  const viewers = await api('GET', `/api/moments/${state.textMoment._id}/viewers`, { client: state.owner });
  assert.equal(viewers.data.viewers.length, 1);
  assert(!viewers.data.viewers[0].viewer.email, 'viewer email is not exposed');
});

test('06 Moment content is excluded from message search', async () => {
  const search = await api('GET', `/api/messages/search/global?q=${encodeURIComponent('private moment body')}`, { client: state.owner });
  const results = search.data.messages || search.data.results || [];
  assert.equal(results.length, 0, 'Moment body is absent from message search');
});

test('07 contacts except excludes selected contact', async () => {
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'excluded audience', audienceType: 'contacts_except', selectedUserIds: [state.other.user._id] },
    expected: 201,
  });
  state.exceptMoment = created.data.moment;
  const otherFeed = await api('GET', '/api/moments/feed', { client: state.other });
  assert(![...otherFeed.data.recentMoments, ...otherFeed.data.viewedMoments].some((moment) => moment._id === state.exceptMoment._id), 'excluded contact cannot see Moment');
});

test('08 only share with limits audience', async () => {
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'limited audience', audienceType: 'only_share_with', selectedUserIds: [state.viewer.user._id] },
    expected: 201,
  });
  state.limitedMoment = created.data.moment;
  const viewerFeed = await api('GET', '/api/moments/feed', { client: state.viewer });
  const otherFeed = await api('GET', '/api/moments/feed', { client: state.other });
  assert(viewerFeed.data.recentMoments.some((moment) => moment._id === state.limitedMoment._id), 'selected contact can see Moment');
  assert(!otherFeed.data.recentMoments.some((moment) => moment._id === state.limitedMoment._id), 'unselected contact cannot see Moment');
});

test('09 Close Friends Moments use saved list', async () => {
  await api('POST', '/api/moments/close-friends', { client: state.owner, body: { userId: state.viewer.user._id } });
  const closeFriends = await api('GET', '/api/moments/close-friends', { client: state.owner });
  assert.equal(closeFriends.data.closeFriends.length, 1);
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'close friends only', audienceType: 'close_friends' },
    expected: 201,
  });
  state.closeFriendMoment = created.data.moment;
  const viewerFeed = await api('GET', '/api/moments/feed', { client: state.viewer });
  const otherFeed = await api('GET', '/api/moments/feed', { client: state.other });
  assert(viewerFeed.data.recentMoments.some((moment) => moment._id === state.closeFriendMoment._id), 'close friend sees Moment');
  assert(!otherFeed.data.recentMoments.some((moment) => moment._id === state.closeFriendMoment._id), 'non-close friend cannot see Moment');
});

test('10 blocking removes Moment access', async () => {
  await api('POST', `/api/users/${state.blocked.user._id}/block`, { client: state.owner });
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'block protected', audienceType: 'contacts' },
    expected: 201,
  });
  const feed = await api('GET', '/api/moments/feed', { client: state.blocked });
  assert(!feed.data.recentMoments.some((moment) => moment._id === created.data.moment._id), 'blocked user cannot see Moment');
});

test('11 photo Moment uses authorized Moment media endpoint', async () => {
  const mediaId = await uploadTinyPng(state.owner);
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'image', mediaId, caption: 'photo caption', audienceType: 'only_share_with', selectedUserIds: [state.viewer.user._id] },
    expected: 201,
  });
  state.photoMoment = created.data.moment;
  assert(created.data.moment.mediaUrl.includes('/api/moments/'), 'Moment media URL is scoped');
  await api('GET', created.data.moment.mediaUrl, { client: state.viewer, expected: 200 });
  await api('GET', `/api/media/local/${mediaId}`, { client: state.viewer, expected: 404 });
});

test('12 video Moments are deferred', async () => {
  await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'video', mediaId: '000000000000000000000000', audienceType: 'contacts' },
    expected: 400,
  });
});

test('13 expiry archives by default and hides active feed', async () => {
  await api('PATCH', '/api/moments/archive-settings', { client: state.owner, body: { momentArchiveEnabled: true } });
  const created = await api('POST', '/api/moments', {
    client: state.owner,
    body: { type: 'text', textBody: 'expiring moment', audienceType: 'only_share_with', selectedUserIds: [state.viewer.user._id] },
    expected: 201,
  });
  await expireMomentInDocker(created.data.moment._id);
  await api('POST', '/api/moments/worker/run', { client: state.owner });
  const viewerFeed = await api('GET', '/api/moments/feed', { client: state.viewer });
  assert(!viewerFeed.data.recentMoments.some((moment) => moment._id === created.data.moment._id), 'expired Moment leaves active feed');
  const archive = await api('GET', '/api/moments/archive', { client: state.owner });
  assert(archive.data.moments.some((moment) => moment._id === created.data.moment._id), 'expired Moment appears in private archive');
});

test('14 author delete removes active Moment', async () => {
  await api('DELETE', `/api/moments/${state.limitedMoment._id}`, { client: state.owner });
  await api('GET', `/api/moments/${state.limitedMoment._id}`, { client: state.viewer, expected: 404 });
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
