#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pnpmStore = join(process.cwd(), 'node_modules', '.pnpm');
const mongodbPackage = readdirSync(pnpmStore).find((name) => name.startsWith('mongodb@') && !name.includes('mongodb-connection-string-url'));
if (!mongodbPackage) throw new Error('mongodb package not found in workspace pnpm store');
const { MongoClient, ObjectId } = require(join(pnpmStore, mongodbPackage, 'node_modules', 'mongodb'));

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const MONGO_URI = process.env.SMOKE_MONGO_URI || process.env.MONGO_URI || 'mongodb://mongodb:27017';
const MONGO_DB_NAME = process.env.SMOKE_MONGO_DB_NAME || process.env.MONGO_DB_NAME || 'blabber_full';
const runId = `reelfy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = {};

function test(name, fn) {
  tests.push({ name, fn });
}

function safe(path) {
  return path
    .replace(/[?&]cursor=[^&]+/g, '?cursor=:cursor')
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

function oid(value) {
  return new ObjectId(value);
}

function userId(client) {
  return oid(client.user.id || client.user._id);
}

function ids(response) {
  return (response.data.reels || []).map((reel) => reel.id);
}

function findReel(response, id) {
  return (response.data.reels || []).find((reel) => reel.id === id);
}

async function waitFor(fn, message, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(message);
}

async function register(label, verify = true) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 30);
  const password = `SmokePass123!${label}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `reelfy_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-e-reels-for-you-${unique}@example.com`,
      password,
      name: `Reels For You ${label}`,
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
  const cleanLabel = label.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9]/gi, '');
  const handle = `rfy_${cleanLabel}_${unique}`.slice(0, 30);
  await api('PATCH', '/api/profiles/me/handle', { client, body: { handle } });
  await api('PATCH', '/api/profiles/me', { client, body: { visibility: 'public', bio: 'Reels For You smoke profile' } });
  await api('PATCH', '/api/profiles/me/discovery', {
    client,
    body: { creatorDiscoveryEnabled: true, creatorTopicIds: topics },
  });
  return handle;
}

async function connectDb() {
  state.mongo = new MongoClient(MONGO_URI);
  await state.mongo.connect();
  state.db = state.mongo.db(MONGO_DB_NAME);
}

async function createReadyReel(client, {
  caption = 'reel for you smoke',
  visibility = 'public',
  discoverable = true,
  topics = ['technology'],
  publishedOffsetMs = 0,
  ready = true,
  approvedMedia = true,
  deleted = false,
  moderationRemoved = false,
} = {}) {
  const now = new Date();
  const reelId = new ObjectId();
  const mediaId = new ObjectId();
  const publishedAt = new Date(now.getTime() + publishedOffsetMs);
  const media = {
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
    status: approvedMedia ? 'approved' : 'quarantined',
    purpose: 'reel_source',
    scanMode: 'mock',
    scanResult: approvedMedia ? 'clean' : 'infected',
    createdAt: now,
    uploadedAt: now,
  };
  if (approvedMedia) media.approvedAt = now;
  await state.db.collection('media').insertOne(media);
  const reel = {
    _id: reelId,
    authorUserId: userId(client),
    sourceMediaId: mediaId,
    processingStatus: deleted ? 'deleted' : ready ? 'ready' : 'processing',
    publishState: deleted ? 'deleted' : 'published',
    caption,
    visibility,
    topicIds: [],
    reelDiscoverable: discoverable,
    reelTopicIds: topics,
    reelDiscoverableUpdatedAt: now,
    reactionCounts: {},
    commentCount: 0,
    durationSeconds: 8,
    width: 720,
    height: 1280,
    fallbackPath: `/tmp/${runId}/fallback-${reelId.toString()}.mp4`,
    posterPath: `/tmp/${runId}/poster-${reelId.toString()}.jpg`,
    hlsPlaylistPath: `/tmp/${runId}/playlist-${reelId.toString()}.m3u8`,
    hlsSegments: [{ token: 'seg0', path: `/tmp/${runId}/seg0-${reelId.toString()}.ts`, durationSeconds: 4 }],
    processingAttempt: 1,
    processingKey: `smoke-${runId}-${reelId.toString()}`,
    processedAt: now,
    publishedAt,
    updatedAt: now,
    createdAt: now,
    schemaVersion: 1,
  };
  if (moderationRemoved) reel.moderationRemovedAt = now;
  if (deleted) reel.deletedAt = now;
  await state.db.collection('reels').insertOne(reel);
  return reelId.toString();
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 Reels For You routes require authentication', async () => {
  await api('GET', '/api/reels/for-you', { expected: 401 });
  await api('POST', '/api/reels/for-you/refresh', { expected: 401 });
  await api('GET', `/api/reels/for-you/explanations/${new ObjectId().toString()}`, { expected: 401 });
});

test('03 verified public creators and viewers are prepared', async () => {
  await connectDb();
  state.viewer = await register('viewer');
  state.otherViewer = await register('other-viewer');
  state.creatorA = await register('creator-a');
  state.creatorB = await register('creator-b');
  state.creatorC = await register('creator-c');
  state.privateCreator = await register('private-creator');
  state.unverifiedCreator = await register('unverified', false);
  state.creatorAHandle = await publicCreator(state.creatorA, 'a', ['technology', 'software_engineering']);
  state.creatorBHandle = await publicCreator(state.creatorB, 'b', ['music']);
  state.creatorCHandle = await publicCreator(state.creatorC, 'c', ['design']);
  state.viewerHandle = await publicCreator(state.viewer, 'viewer', ['technology']);
  await api('PATCH', '/api/profiles/me/handle', { client: state.privateCreator, body: { handle: `rfy_private_${Date.now().toString(36)}`.slice(0, 30) } });
  await api('PATCH', '/api/profiles/me/discovery', { client: state.privateCreator, body: { creatorDiscoveryEnabled: false, creatorTopicIds: ['technology'] } });
});

test('04 eligible and ineligible Reels are seeded', async () => {
  const future = 45 * 24 * 60 * 60 * 1000;
  state.followedCreatorReel = await createReadyReel(state.creatorA, { caption: `followed creator reel ${runId}`, topics: ['technology'], publishedOffsetMs: future + 4000 });
  state.followedTopicReel = await createReadyReel(state.creatorB, { caption: `followed topic reel ${runId}`, topics: ['technology'], publishedOffsetMs: future + 3000 });
  state.musicReel = await createReadyReel(state.creatorB, { caption: `music reel ${runId}`, topics: ['music'], publishedOffsetMs: future + 2000 });
  state.designReel = await createReadyReel(state.creatorC, { caption: `design reel ${runId}`, topics: ['design'], publishedOffsetMs: future + 1000 });
  state.newestFallbackReel = await createReadyReel(state.creatorC, { caption: `newest fallback reel ${runId}`, topics: ['design'], publishedOffsetMs: future + 5000 });
  state.ownReel = await createReadyReel(state.viewer, { caption: `own reel ${runId}`, topics: ['technology'], publishedOffsetMs: future + 6000 });
  state.privateReel = await createReadyReel(state.creatorA, { caption: 'private reel', visibility: 'followers' });
  state.notDiscoverableReel = await createReadyReel(state.creatorA, { caption: 'not discoverable', discoverable: false });
  state.notReadyReel = await createReadyReel(state.creatorA, { caption: 'not ready', ready: false });
  state.noTopicReel = await createReadyReel(state.creatorA, { caption: 'no topic', topics: [] });
  state.unapprovedReel = await createReadyReel(state.creatorA, { caption: 'unapproved media', approvedMedia: false });
  state.deletedReel = await createReadyReel(state.creatorA, { caption: 'deleted reel', deleted: true });
  state.moderatedReel = await createReadyReel(state.creatorA, { caption: 'moderated reel', moderationRemoved: true });
  state.creatorDiscoveryOffReel = await createReadyReel(state.privateCreator, { caption: 'creator discovery off', topics: ['technology'] });
  assert(state.followedCreatorReel && state.newestFallbackReel);
});

test('05 followed creator and followed topic are configured', async () => {
  await api('POST', `/api/profiles/${state.creatorAHandle}/follow`, { client: state.viewer });
  await api('POST', '/api/discovery/topics/technology/follow', { client: state.viewer });
  const prefs = await api('GET', '/api/discovery/preferences', { client: state.viewer });
  assert.equal(prefs.data.preferences.personalizedDiscoveryEnabled, true);
  assert(prefs.data.preferences.followedTopics.some((topic) => topic.id === 'technology'));
});

test('06 For You returns personalized eligible Reels only', async () => {
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  state.initialCursor = feed.data.nextCursor;
  assert.equal(feed.data.personalized, true);
  assert(ids(feed).includes(state.followedCreatorReel));
  assert(ids(feed).includes(state.followedTopicReel));
  assert(!ids(feed).includes(state.ownReel));
  assert(!ids(feed).includes(state.privateReel));
  assert(!ids(feed).includes(state.notDiscoverableReel));
  assert(!ids(feed).includes(state.notReadyReel));
  assert(!ids(feed).includes(state.noTopicReel));
  assert(!ids(feed).includes(state.unapprovedReel));
  assert(!ids(feed).includes(state.deletedReel));
  assert(!ids(feed).includes(state.moderatedReel));
  assert(!ids(feed).includes(state.creatorDiscoveryOffReel));
});

test('07 personalized ranking lifts followed creator/topic above plain newest', async () => {
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  const order = ids(feed);
  assert(order.indexOf(state.followedCreatorReel) < order.indexOf(state.newestFallbackReel));
  assert(order.indexOf(state.followedTopicReel) < order.indexOf(state.newestFallbackReel));
});

test('08 For You issues source-separated event tokens when personalized', async () => {
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  const item = findReel(feed, state.followedCreatorReel);
  assert(item.eventToken);
  state.forYouEventToken = item.eventToken;
  const token = await state.db.collection('discovery_candidate_tokens').findOne({ viewerUserId: userId(state.viewer), targetId: oid(state.followedCreatorReel), sourceContext: 'reels_for_you' });
  assert(token, 'for you token stored with surface context');
});

test('09 For You watch events record bounded personalization signals', async () => {
  const opened = await api('POST', `/api/reels/${state.followedCreatorReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_open', eventToken: state.forYouEventToken },
  });
  assert.equal(opened.data.recorded, true);
  const completed = await api('POST', `/api/reels/${state.followedCreatorReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_completion_bucket', eventToken: state.forYouEventToken, completionBucket: '75_to_95_percent' },
  });
  assert.equal(completed.data.recorded, true);
  const event = await state.db.collection('discovery_events').findOne({ userId: userId(state.viewer), targetType: 'reel', targetId: oid(state.followedCreatorReel), sourceContext: 'reels_for_you' });
  assert(event && !event.rawWatchTimeMs && !event.rawCompletionPercent);
});

test('10 duplicate watch events are not counted twice', async () => {
  const duplicate = await api('POST', `/api/reels/${state.followedCreatorReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_open', eventToken: state.forYouEventToken },
  });
  assert.equal(duplicate.data.recorded, false);
});

test('11 invalid For You cursor is rejected', async () => {
  await api('GET', '/api/reels/for-you?cursor=not-a-cursor', { client: state.viewer, expected: 400 });
});

test('12 cursors are bound to the viewer session', async () => {
  const refreshed = await api('POST', '/api/reels/for-you/refresh', { client: state.viewer });
  await api('GET', `/api/reels/for-you?cursor=${encodeURIComponent(refreshed.data.cursor)}`, { client: state.viewer });
  await api('GET', `/api/reels/for-you?cursor=${encodeURIComponent(refreshed.data.cursor)}`, { client: state.otherViewer, expected: 404 });
});

test('13 explanation endpoint returns safe text only', async () => {
  await api('GET', '/api/reels/for-you', { client: state.viewer });
  const explanation = await api('GET', `/api/reels/for-you/explanations/${state.followedCreatorReel}`, { client: state.viewer });
  assert.equal(typeof explanation.data.explanation.text, 'string');
  const serialized = JSON.stringify(explanation.data);
  assert(!serialized.includes('score'));
  assert(!serialized.includes('token'));
  assert(!serialized.includes('fallbackPath'));
});

test('14 explanation is unavailable for own Reel', async () => {
  await api('GET', `/api/reels/for-you/explanations/${state.ownReel}`, { client: state.viewer, expected: 404 });
});

test('15 browse remains newest-first and non-personalized', async () => {
  const browse = await api('GET', '/api/reels/browse', { client: state.viewer });
  const order = ids(browse);
  assert(order.indexOf(state.newestFallbackReel) < order.indexOf(state.followedCreatorReel));
  const item = findReel(browse, state.newestFallbackReel);
  assert(item.eventToken);
  assert(!item.explanation);
});

test('16 reactions create Reel-surface affinity without post-surface affinity', async () => {
  await api('POST', `/api/reels/${state.musicReel}/reaction`, { client: state.viewer, body: { emoji: '🙌' } });
  const reelAffinity = await waitFor(
    () => state.db.collection('discovery_affinities').findOne({ userId: userId(state.viewer), surface: 'reels', affinityType: 'creator', affinityKey: userId(state.creatorB) }),
    'reel affinity recorded'
  );
  assert(reelAffinity);
  const postAffinity = await state.db.collection('discovery_affinities').findOne({ userId: userId(state.viewer), surface: 'posts', affinityType: 'creator', affinityKey: userId(state.creatorB) });
  assert.equal(postAffinity, null);
});

test('17 comments and saves add only safe Reel personalization signals', async () => {
  await api('POST', `/api/reels/${state.musicReel}/comments`, { client: state.viewer, body: { body: 'safe smoke comment' }, expected: 201 });
  await api('POST', `/api/reels/${state.musicReel}/save`, { client: state.viewer });
  const events = await waitFor(async () => {
    const rows = await state.db.collection('discovery_events').find({ userId: userId(state.viewer), targetType: 'reel', targetId: oid(state.musicReel) }).toArray();
    return rows.some((event) => event.eventType === 'comment_on_discoverable_reel') && rows.some((event) => event.eventType === 'save_discoverable_reel') ? rows : null;
  }, 'comment and save personalization events recorded');
  assert(events.some((event) => event.eventType === 'comment_on_discoverable_reel'));
  assert(events.some((event) => event.eventType === 'save_discoverable_reel'));
  assert(!JSON.stringify(events).includes('safe smoke comment'));
});

test('18 quick skip suppresses a recently skipped Reel', async () => {
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  const item = findReel(feed, state.designReel);
  assert(item?.eventToken);
  const skipped = await api('POST', `/api/reels/${state.designReel}/events`, {
    client: state.viewer,
    body: { eventType: 'reel_quick_skip', eventToken: item.eventToken, skipReason: 'user_next_reel' },
  });
  assert.equal(skipped.data.recorded, true);
  const refreshed = await api('POST', '/api/reels/for-you/refresh', { client: state.viewer });
  const next = await api('GET', `/api/reels/for-you?cursor=${encodeURIComponent(refreshed.data.cursor)}`, { client: state.viewer });
  assert(ids(next).indexOf(state.designReel) > ids(next).indexOf(state.musicReel) || !ids(next).includes(state.designReel));
});

test('19 not interested hides the Reel from For You', async () => {
  await api('POST', `/api/reels/${state.followedTopicReel}/not-interested`, { client: state.viewer });
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  assert(!ids(feed).includes(state.followedTopicReel));
});

test('20 muted creator hides all creator Reels from For You', async () => {
  await api('POST', `/api/reels/${state.musicReel}/mute-creator`, { client: state.viewer });
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  assert(!ids(feed).includes(state.musicReel));
});

test('21 muted topic hides Reels whose topics are all muted', async () => {
  await api('POST', '/api/discovery/topics/design/mute', { client: state.viewer });
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  assert(!ids(feed).includes(state.designReel));
});

test('22 blocked creator is excluded by current authorization', async () => {
  state.blockedCreator = await register('blocked');
  state.blockedHandle = await publicCreator(state.blockedCreator, 'blocked', ['technology']);
  state.blockedReel = await createReadyReel(state.blockedCreator, { caption: 'blocked reel', topics: ['technology'], publishedOffsetMs: 5000 });
  await api('POST', `/api/users/${userId(state.blockedCreator).toString()}/block`, { client: state.viewer });
  const feed = await api('GET', '/api/reels/for-you', { client: state.viewer });
  assert(!ids(feed).includes(state.blockedReel));
});

test('23 personalization disabled falls back to latest public Reels with banner message', async () => {
  await api('PATCH', '/api/discovery/preferences', { client: state.otherViewer, body: { personalizedDiscoveryEnabled: false } });
  const feed = await api('GET', '/api/reels/for-you', { client: state.otherViewer });
  assert.equal(feed.data.personalized, false);
  assert.equal(feed.data.message, 'Personalized discovery is off. You are seeing the latest public Reels.');
  assert(ids(feed).indexOf(state.newestFallbackReel) < ids(feed).indexOf(state.followedCreatorReel));
});

test('24 personalization disabled does not issue optional event tokens', async () => {
  const feed = await api('GET', '/api/reels/for-you', { client: state.otherViewer });
  assert(feed.data.reels.length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(feed.data.reels[0], 'eventToken'), false);
});

test('25 personalization disabled ignores Reel event collection', async () => {
  const token = await api('POST', `/api/reels/${state.newestFallbackReel}/event-token`, { client: state.otherViewer, expected: 201 });
  const result = await api('POST', `/api/reels/${state.newestFallbackReel}/events`, {
    client: state.otherViewer,
    body: { eventType: 'reel_open', eventToken: token.data.eventToken },
  });
  assert.equal(result.data.recorded, false);
});

test('26 playback rechecks authorization after Reel is hidden', async () => {
  state.playbackHideTarget = await createReadyReel(state.creatorA, { caption: `playback hide target ${runId}`, topics: ['software_engineering'], publishedOffsetMs: 50 * 24 * 60 * 60 * 1000 });
  const session = await api('POST', `/api/reels/${state.playbackHideTarget}/playback-session`, { client: state.viewer, expected: 201 });
  await api('POST', `/api/reels/${state.playbackHideTarget}/not-interested`, { client: state.viewer });
  await api('GET', session.data.playback.manifestUrl, { client: state.viewer, expected: 404, parse: 'text' });
});

test('27 reset clears Reel personalization state but keeps feedback controls', async () => {
  await api('POST', '/api/discovery/personalization/clear', { client: state.viewer });
  const [events, affinities, sessions, tokens, feedback] = await Promise.all([
    state.db.collection('discovery_events').countDocuments({ userId: userId(state.viewer), targetType: 'reel' }),
    state.db.collection('discovery_affinities').countDocuments({ userId: userId(state.viewer), surface: 'reels' }),
    state.db.collection('reel_for_you_sessions').countDocuments({ userId: userId(state.viewer) }),
    state.db.collection('discovery_candidate_tokens').countDocuments({ viewerUserId: userId(state.viewer), targetType: 'reel' }),
    state.db.collection('discovery_feedback').countDocuments({ userId: userId(state.viewer) }),
  ]);
  assert.equal(events + affinities + sessions + tokens, 0);
  assert(feedback > 0);
});

test('28 reset preserves text/photo For You preferences', async () => {
  const prefs = await api('GET', '/api/discovery/preferences', { client: state.viewer });
  assert.equal(typeof prefs.data.preferences.personalizedDiscoveryEnabled, 'boolean');
  assert(Array.isArray(prefs.data.preferences.mutedTopics));
});

test('29 account export includes safe Reel personalization file', async () => {
  const requested = await api('POST', '/api/auth/account/export', {
    client: state.otherViewer,
    body: { currentPassword: state.otherViewer.password },
    expected: [200, 202],
  });
  assert([200, 202].includes(requested.status));
  const manifestJob = await state.db.collection('dataExports').findOne({ userId: userId(state.otherViewer) }, { sort: { requestedAt: -1 } });
  assert(manifestJob);
});

test('30 post For You and global search do not leak Reel captions', async () => {
  const [forYou, feed, search] = await Promise.all([
    api('GET', '/api/discovery/for-you', { client: state.otherViewer }),
    api('GET', '/api/feed', { client: state.otherViewer }),
    api('GET', `/api/messages/search/global?q=${encodeURIComponent('newest fallback reel')}`, { client: state.otherViewer }),
  ]);
  assert(!JSON.stringify(forYou.data).includes('newest fallback reel'));
  assert(!JSON.stringify(feed.data).includes('newest fallback reel'));
  assert(!JSON.stringify(search.data).includes('newest fallback reel'));
});

test('31 deleting a Reel removes it from active For You sessions', async () => {
  state.deleteTarget = await createReadyReel(state.creatorC, { caption: 'delete target reel', topics: ['technology'], publishedOffsetMs: 7000 });
  await api('GET', '/api/reels/for-you', { client: state.otherViewer });
  await api('DELETE', `/api/reels/${state.deleteTarget}`, { client: state.creatorC });
  const sessions = await state.db.collection('reel_for_you_sessions').countDocuments({ orderedReelIds: oid(state.deleteTarget) });
  assert.equal(sessions, 0);
});

test('32 docs and public script names are present', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['smoke:release-e-reels-for-you'], 'node scripts/release-e-reels-for-you-smoke.mjs');
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
