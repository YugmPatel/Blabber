#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pnpmStore = join(process.cwd(), 'node_modules', '.pnpm');
const mongodbPackage = readdirSync(pnpmStore).find((name) => name.startsWith('mongodb@') && !name.includes('mongodb-connection-string-url'));
if (!mongodbPackage) throw new Error('mongodb package not found in workspace pnpm store');
const { MongoClient, ObjectId } = require(join(pnpmStore, mongodbPackage, 'node_modules', 'mongodb'));

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const MONGO_URI = process.env.SMOKE_MONGO_URI || process.env.MONGO_URI || 'mongodb://mongodb:27017';
const MONGO_DB_NAME = process.env.SMOKE_MONGO_DB_NAME || process.env.MONGO_DB_NAME || 'blabber_full';
const runId = `reelv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function safe(path) {
  return path
    .replace(/\/playback\/[^/]+/g, '/playback/:token')
    .replace(/[A-Za-z0-9_-]{24,}/g, ':token')
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
  const data = parse === 'text'
    ? await response.text()
    : contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const message = typeof data?.message === 'string' ? data.message : 'Unexpected response';
    throw new Error(`${method} ${safe(path.split('?')[0])} returned ${response.status}: ${message}`);
  }
  return { status: response.status, data, headers: response.headers };
}

function userId(client) {
  return new ObjectId(client.user.id || client.user._id);
}

async function register(label, verify = true) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 30);
  const password = `SmokePass123!${label}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `reelv_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-e-reels-${unique}@example.com`,
      password,
      name: `Reels ${label}`,
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

async function configurePublicCreator(client, label) {
  const handle = `reelv_${runId.replace(/[^a-z0-9]/g, '').slice(0, 10)}_${label}`.slice(0, 30);
  await api('PATCH', '/api/profiles/me/handle', { client, body: { handle } });
  await api('PATCH', '/api/profiles/me', { client, body: { visibility: 'public' } });
  await api('PATCH', '/api/profiles/me/discovery', {
    client,
    body: { creatorDiscoveryEnabled: true, creatorTopicIds: ['technology'] },
  });
  return handle;
}

async function connectDb() {
  state.mongo = new MongoClient(MONGO_URI);
  await state.mongo.connect();
  state.db = state.mongo.db(MONGO_DB_NAME);
}

async function createReadyReel(client, {
  caption = '',
  visibility = 'public',
  discoverable = true,
  topics = ['technology'],
  publishedOffsetMs = 0,
  ready = true,
} = {}) {
  const now = new Date();
  const reelId = new ObjectId();
  const mediaId = new ObjectId();
  const publishedAt = new Date(now.getTime() + publishedOffsetMs);
  await state.db.collection('media').insertOne({
    _id: mediaId,
    userId: userId(client),
    fileName: 'fixture.mp4',
    originalFileName: 'fixture.mp4',
    fileType: 'video/mp4',
    detectedFileType: 'video/mp4',
    fileSize: 1024,
    s3Key: `smoke/${runId}/${reelId.toString()}/source.mp4`,
    url: '',
    storage: 'local',
    status: 'approved',
    purpose: 'reel_source',
    scanMode: 'mock',
    scanResult: 'clean',
    createdAt: now,
    uploadedAt: now,
    approvedAt: now,
  });
  await state.db.collection('reels').insertOne({
    _id: reelId,
    authorUserId: userId(client),
    sourceMediaId: mediaId,
    processingStatus: ready ? 'ready' : 'processing',
    publishState: 'published',
    caption,
    visibility,
    topicIds: [],
    reelDiscoverable: discoverable,
    reelTopicIds: topics,
    reelDiscoverableUpdatedAt: now,
    reactionCounts: {},
    commentCount: 0,
    durationSeconds: 7,
    width: 720,
    height: 1280,
    fallbackPath: `/tmp/${runId}/fallback.mp4`,
    posterPath: `/tmp/${runId}/poster.jpg`,
    hlsPlaylistPath: `/tmp/${runId}/playlist.m3u8`,
    hlsSegments: [{ token: 'seg0', path: `/tmp/${runId}/seg0.ts`, durationSeconds: 4 }],
    processingAttempt: 1,
    processingKey: `smoke-${runId}-${reelId.toString()}`,
    processedAt: now,
    publishedAt,
    updatedAt: now,
    createdAt: now,
    schemaVersion: 1,
  });
  return reelId.toString();
}

function hasReel(items, id) {
  return items.some((item) => item.id === id);
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 users and public creator profiles are prepared', async () => {
  await connectDb();
  state.owner = await register('owner');
  state.viewer = await register('viewer');
  state.other = await register('other');
  state.ownerHandle = await configurePublicCreator(state.owner, 'owner');
  state.viewerHandle = await configurePublicCreator(state.viewer, 'viewer');
  await configurePublicCreator(state.other, 'other');
});

test('03 Reels Browse and saved routes require authentication', async () => {
  await api('GET', '/api/reels/browse', { expected: 401 });
  await api('GET', '/api/reels/saved', { expected: 401 });
});

test('04 controlled discovery topics are available', async () => {
  const topics = await api('GET', '/api/discovery/topics', { client: state.viewer });
  assert(topics.data.topics.some((topic) => topic.id === 'technology'));
  assert(!topics.data.topics.some((topic) => topic.id === 'politics'));
});

test('05 fixture Reels are seeded as processed candidates', async () => {
  await state.db.collection('reels').deleteMany({
    caption: {
      $in: [
        'older viewer smoke',
        'newer viewer smoke',
        'music viewer smoke',
        'followers viewer smoke',
        'hidden viewer smoke',
        'processing viewer smoke',
      ],
    },
  });
  state.olderReel = await createReadyReel(state.owner, { caption: 'older viewer smoke', publishedOffsetMs: 60 * 60 * 1000 });
  state.newerReel = await createReadyReel(state.owner, { caption: 'newer viewer smoke', publishedOffsetMs: 2 * 60 * 60 * 1000 });
  state.otherTopicReel = await createReadyReel(state.owner, { caption: 'music viewer smoke', topics: ['music'], publishedOffsetMs: 90 * 60 * 1000 });
  state.privateReel = await createReadyReel(state.owner, { caption: 'followers viewer smoke', visibility: 'followers', discoverable: true });
  state.notDiscoverableReel = await createReadyReel(state.owner, { caption: 'hidden viewer smoke', discoverable: false });
  state.notReadyReel = await createReadyReel(state.owner, { caption: 'processing viewer smoke', ready: false });
  assert(state.newerReel && state.olderReel);
});

test('06 browse is newest-first and includes only eligible public opted-in Reels', async () => {
  const browse = await api('GET', '/api/reels/browse?topic=technology', { client: state.viewer });
  const ids = browse.data.reels.map((reel) => reel.id);
  assert(ids.indexOf(state.newerReel) < ids.indexOf(state.olderReel));
  assert(!hasReel(browse.data.reels, state.privateReel));
  assert(!hasReel(browse.data.reels, state.notDiscoverableReel));
  assert(!hasReel(browse.data.reels, state.notReadyReel));
});

test('07 topic filtering narrows browse candidates', async () => {
  const tech = await api('GET', '/api/reels/browse?topic=technology', { client: state.viewer });
  assert(hasReel(tech.data.reels, state.newerReel));
  assert(!hasReel(tech.data.reels, state.otherTopicReel));
  const music = await api('GET', '/api/reels/browse?topic=music', { client: state.viewer });
  assert(hasReel(music.data.reels, state.otherTopicReel));
});

test('08 creator can see their own eligible Reel in browse', async () => {
  const browse = await api('GET', '/api/reels/browse?topic=technology', { client: state.owner });
  assert(hasReel(browse.data.reels, state.newerReel));
});

test('09 owner-only discoverability settings are serialized on detail', async () => {
  const ownerDetail = await api('GET', `/api/reels/${state.newerReel}`, { client: state.owner });
  assert.equal(ownerDetail.data.reel.reelDiscoverable, true);
  assert(ownerDetail.data.reel.reelTopics.some((topic) => topic.id === 'technology'));
  const viewerDetail = await api('GET', `/api/reels/${state.newerReel}`, { client: state.viewer });
  assert.equal(Object.prototype.hasOwnProperty.call(viewerDetail.data.reel, 'eventToken'), false);
});

test('10 discoverability update validates public ready topic-gated Reels', async () => {
  await api('PATCH', `/api/reels/${state.privateReel}/discovery`, {
    client: state.owner,
    body: { reelDiscoverable: true, reelTopicIds: ['technology'] },
    expected: 400,
  });
  const updated = await api('PATCH', `/api/reels/${state.notDiscoverableReel}/discovery`, {
    client: state.owner,
    body: { reelDiscoverable: true, reelTopicIds: ['technology', 'software_engineering'] },
  });
  assert.equal(updated.data.reel.reelDiscoverable, true);
});

test('11 event tokens are issued only for browse-eligible Reels', async () => {
  const token = await api('POST', `/api/reels/${state.newerReel}/event-token`, { client: state.viewer, expected: 201 });
  assert.equal(token.data.expiresInSeconds, 900);
  state.eventToken = token.data.eventToken;
  await api('POST', `/api/reels/${state.privateReel}/event-token`, { client: state.viewer, expected: 404 });
});

test('12 watch events accept valid tokens and reject invalid tokens', async () => {
  const first = await api('POST', `/api/reels/${state.newerReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_open', eventToken: state.eventToken },
  });
  assert.equal(first.data.recorded, true);
  const duplicate = await api('POST', `/api/reels/${state.newerReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_open', eventToken: state.eventToken },
  });
  assert.equal(duplicate.data.recorded, false);
  await api('POST', `/api/reels/${state.newerReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_open', eventToken: 'unknown-token-0000' },
    expected: 404,
  });
});

test('13 watch event validation rejects mismatched bucket fields', async () => {
  await api('POST', `/api/reels/${state.newerReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_watch_bucket', eventToken: state.eventToken },
    expected: 400,
  });
  await api('POST', `/api/reels/${state.newerReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_quick_skip', eventToken: state.eventToken, skipReason: 'user_next_reel' },
  });
});

test('14 playback session and HLS manifest remain authorized', async () => {
  const session = await api('POST', `/api/reels/${state.newerReel}/playback-session`, { client: state.viewer, expected: 201 });
  state.manifestUrl = session.data.playback.manifestUrl;
  const manifest = await api('GET', state.manifestUrl, { client: state.viewer, parse: 'text' });
  assert(String(manifest.data).includes('#EXTM3U'));
  const playlistPath = String(manifest.data).split('\n').find((line) => line.startsWith('/api/'));
  const playlist = await api('GET', playlistPath, { client: state.viewer, parse: 'text' });
  assert(String(playlist.data).includes('#EXT-X-ENDLIST'));
  await api('GET', state.manifestUrl, { client: state.other, expected: 404, parse: 'text' });
});

test('15 reaction create increments counts and sends safe state', async () => {
  const result = await api('POST', `/api/reels/${state.newerReel}/reaction`, { client: state.viewer, body: { emoji: '❤️' } });
  assert.equal(result.data.myReaction, '❤️');
  assert.equal(result.data.reactionCounts['❤️'], 1);
});

test('16 reaction replace keeps one active reaction', async () => {
  const result = await api('POST', `/api/reels/${state.newerReel}/reaction`, { client: state.viewer, body: { emoji: '😂' } });
  assert.equal(result.data.myReaction, '😂');
  assert.equal(result.data.reactionCounts['❤️'] || 0, 0);
  assert.equal(result.data.reactionCounts['😂'], 1);
});

test('17 invalid reaction emoji is rejected', async () => {
  await api('POST', `/api/reels/${state.newerReel}/reaction`, { client: state.viewer, body: { emoji: '🔥' }, expected: 400 });
});

test('18 reaction removal clears viewer state', async () => {
  const result = await api('DELETE', `/api/reels/${state.newerReel}/reaction`, { client: state.viewer });
  assert.equal(result.data.myReaction, null);
  assert.equal(result.data.reactionCounts['😂'] || 0, 0);
});

test('19 comments can be created and listed newest-first', async () => {
  const first = await api('POST', `/api/reels/${state.newerReel}/comments`, { client: state.viewer, body: { body: 'viewer comment one' }, expected: 201 });
  state.viewerComment = first.data.comment.id;
  const second = await api('POST', `/api/reels/${state.newerReel}/comments`, { client: state.other, body: { body: 'viewer comment two' }, expected: 201 });
  state.otherComment = second.data.comment.id;
  const listed = await api('GET', `/api/reels/${state.newerReel}/comments`, { client: state.viewer });
  assert.equal(listed.data.comments[0].id, state.otherComment);
  assert(listed.data.comments.some((comment) => comment.id === state.viewerComment));
});

test('20 comment validation and deletion permissions are enforced', async () => {
  await api('POST', `/api/reels/${state.newerReel}/comments`, { client: state.viewer, body: { body: '   ' }, expected: 400 });
  await api('DELETE', `/api/reels/${state.newerReel}/comments/${state.otherComment}`, { client: state.viewer, expected: 403 });
  const deleted = await api('DELETE', `/api/reels/${state.newerReel}/comments/${state.viewerComment}`, { client: state.viewer });
  assert.equal(deleted.data.success, true);
});

test('21 comment report creates reel_comment moderation record safely', async () => {
  const report = await api('POST', `/api/reels/${state.newerReel}/comments/${state.otherComment}/report`, {
    client: state.viewer,
    body: { reason: 'Abusive comment' },
    expected: 201,
  });
  assert.equal(report.data.report.targetType, 'reel_comment');
  assert(!JSON.stringify(report.data).includes('viewer comment two'));
});

test('22 save and saved listing are private to the viewer', async () => {
  const saved = await api('POST', `/api/reels/${state.newerReel}/save`, { client: state.viewer });
  assert.equal(saved.data.saved, true);
  const list = await api('GET', '/api/reels/saved', { client: state.viewer });
  assert(hasReel(list.data.reels, state.newerReel));
  const other = await api('GET', '/api/reels/saved', { client: state.other });
  assert(!hasReel(other.data.reels, state.newerReel));
});

test('23 unsave removes private saved Reel', async () => {
  const removed = await api('DELETE', `/api/reels/${state.newerReel}/save`, { client: state.viewer });
  assert.equal(removed.data.saved, false);
  const list = await api('GET', '/api/reels/saved', { client: state.viewer });
  assert(!hasReel(list.data.reels, state.newerReel));
});

test('24 not interested hides only this Reel for this viewer', async () => {
  await api('POST', `/api/reels/${state.newerReel}/not-interested`, { client: state.viewer });
  const hidden = await api('GET', '/api/reels/browse?topic=technology', { client: state.viewer });
  assert(!hasReel(hidden.data.reels, state.newerReel));
  assert(hasReel(hidden.data.reels, state.olderReel));
  const other = await api('GET', '/api/reels/browse?topic=technology', { client: state.other });
  assert(hasReel(other.data.reels, state.newerReel));
});

test('25 undo not interested restores the Reel', async () => {
  await api('DELETE', `/api/reels/${state.newerReel}/not-interested`, { client: state.viewer });
  const restored = await api('GET', '/api/reels/browse?topic=technology', { client: state.viewer });
  assert(hasReel(restored.data.reels, state.newerReel));
});

test('26 mute creator suppresses creator Reels without affecting other viewers', async () => {
  await api('POST', `/api/reels/${state.olderReel}/mute-creator`, { client: state.viewer });
  const hidden = await api('GET', '/api/reels/browse?topic=technology', { client: state.viewer });
  assert(!hasReel(hidden.data.reels, state.olderReel));
  const other = await api('GET', '/api/reels/browse?topic=technology', { client: state.other });
  assert(hasReel(other.data.reels, state.olderReel));
});

test('27 Reel report stores safe response fields', async () => {
  const report = await api('POST', `/api/reels/${state.newerReel}/report`, { client: state.other, body: { reason: 'Unsafe Reel' }, expected: 201 });
  assert.equal(report.data.report.targetType, 'reel');
  assert(!JSON.stringify(report.data).includes('fallback'));
});

test('28 notification preferences include Reel activity', async () => {
  const id = userId(state.owner).toString();
  const pref = await api('GET', `/api/notifications/preferences/${id}`, { client: state.owner });
  assert.equal(pref.data.preferences.reelActivityEnabled, true);
  const updated = await api('PATCH', `/api/notifications/preferences/${id}`, { client: state.owner, body: { reelActivityEnabled: false } });
  assert.equal(updated.data.preferences.reelActivityEnabled, false);
});

test('29 account export accepts accounts with Reel viewer data', async () => {
  const requested = await api('POST', '/api/auth/account/export', {
    client: state.viewer,
    body: { currentPassword: state.viewer.password },
    expected: [200, 202],
  });
  assert([200, 202].includes(requested.status));
});

test('30 deleting a Reel removes viewer interaction state', async () => {
  await api('DELETE', `/api/reels/${state.newerReel}`, { client: state.owner });
  await api('GET', `/api/reels/${state.newerReel}`, { client: state.viewer, expected: 404 });
  const reactions = await state.db.collection('reel_reactions').countDocuments({ reelId: new ObjectId(state.newerReel) });
  const comments = await state.db.collection('reel_comments').countDocuments({ reelId: new ObjectId(state.newerReel), deletedAt: { $exists: false } });
  const saves = await state.db.collection('reel_saves').countDocuments({ reelId: new ObjectId(state.newerReel) });
  assert.equal(reactions + comments + saves, 0);
});

let passed = 0;
const failures = [];
try {
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`✓ ${item.name}`);
    } catch (error) {
      failures.push(item.name);
      console.error(`✗ ${item.name}`);
      console.error(error?.message || error);
    }
  }
} finally {
  if (state.mongo) await state.mongo.close();
}
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
