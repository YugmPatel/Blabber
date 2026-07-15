import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'crypto';
import { ObjectId } from 'mongodb';
import app from '../app';
import { closeDatabase, connectToDatabase, getDatabase } from '../db';

const runId = `beta-reel-visible-${new ObjectId().toString()}`;
let createdUserIds: ObjectId[] = [];

function signTestToken(userId: string) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify({
    userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  })).toString('base64url');
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', process.env.JWT_ACCESS_SECRET!).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function userDoc(id: ObjectId, username: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  const label = username.split('-').at(-1) || 'user';
  const handlePrefix = runId.replace(/[^a-z0-9]/g, '').slice(0, 18);
  return {
    _id: id,
    username,
    email: `${username}@example.com`,
    passwordHash: 'hashed',
    name: username,
    emailVerified: true,
    profileHandle: `${handlePrefix}_${label}`.slice(0, 30),
    profileVisibility: 'public',
    creatorDiscoveryEnabled: false,
    contacts: [],
    blocked: [],
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

async function insertReadyReel(authorUserId: ObjectId, suffix: string, extra: Record<string, unknown> = {}) {
  const db = getDatabase();
  const now = new Date();
  const publishedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const reelId = new ObjectId();
  const mediaId = new ObjectId();
  await db.collection('media').insertOne({
    _id: mediaId,
    userId: authorUserId,
    fileName: `${suffix}.mp4`,
    originalFileName: `${suffix}.mp4`,
    fileType: 'video/mp4',
    detectedFileType: 'video/mp4',
    fileSize: 4096,
    s3Key: `${runId}/${suffix}/source.mp4`,
    url: '',
    storage: 'local',
    status: 'approved',
    purpose: 'reel_source',
    scanMode: 'mock',
    scanResult: 'clean',
    createdAt: now,
    uploadedAt: now,
    approvedAt: now,
    testRun: runId,
  });
  await db.collection('reels').insertOne({
    _id: reelId,
    authorUserId,
    sourceMediaId: mediaId,
    processingStatus: 'ready',
    publishState: 'published',
    caption: `Beta visible reel ${suffix}`,
    visibility: 'public',
    topicIds: ['campus_life'],
    reelDiscoverable: true,
    reelTopicIds: ['campus_life'],
    reelDiscoverableUpdatedAt: now,
    reactionCounts: {},
    commentCount: 0,
    durationSeconds: 7,
    width: 720,
    height: 1280,
    fallbackPath: `/tmp/${runId}/${suffix}/fallback.mp4`,
    posterPath: `/tmp/${runId}/${suffix}/poster.jpg`,
    hlsPlaylistPath: `/tmp/${runId}/${suffix}/playlist.m3u8`,
    hlsSegments: [{ token: 'seg0', path: `/tmp/${runId}/${suffix}/seg0.ts`, durationSeconds: 4 }],
    processingAttempt: 1,
    processingKey: `${runId}-${suffix}`,
    processedAt: now,
    publishedAt,
    updatedAt: now,
    createdAt: now,
    schemaVersion: 1,
    testRun: runId,
    ...extra,
  });
  return reelId.toString();
}

async function seedFixture() {
  const db = getDatabase();
  const viewerId = new ObjectId();
  const creatorId = new ObjectId();
  const blockedCreatorId = new ObjectId();
  createdUserIds = [viewerId, creatorId, blockedCreatorId];
  const now = new Date();
  const creator = userDoc(creatorId, `${runId}-creator`, {
    creatorDiscoveryEnabled: true,
    creatorDiscoveryEnabledAt: now,
    creatorTopicIds: ['campus_life'],
    discoveryShowReels: true,
  });
  await db.collection('users').insertMany([
    userDoc(viewerId, `${runId}-viewer`),
    creator,
    userDoc(blockedCreatorId, `${runId}-blocked`, {
      creatorDiscoveryEnabled: true,
      creatorDiscoveryEnabledAt: now,
      creatorTopicIds: ['campus_life'],
      discoveryShowReels: true,
    }),
  ]);
  const visibleReelId = await insertReadyReel(creatorId, 'eligible');
  const privateReelId = await insertReadyReel(creatorId, 'private', { visibility: 'followers' });
  const deletedReelId = await insertReadyReel(creatorId, 'deleted', { deletedAt: now });
  const blockedReelId = await insertReadyReel(blockedCreatorId, 'blocked');
  await db.collection('user_blocks').insertOne({
    _id: new ObjectId(),
    blockerUserId: blockedCreatorId,
    blockedUserId: viewerId,
    createdAt: now,
    testRun: runId,
  });
  return {
    token: signTestToken(viewerId.toString()),
    creatorHandle: creator.profileHandle,
    visibleReelId,
    privateReelId,
    deletedReelId,
    blockedReelId,
  };
}

describe('beta seed reel visibility', () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterEach(async () => {
    const db = getDatabase();
    await Promise.all([
      db.collection('users').deleteMany({ username: new RegExp(`^${runId}`) }),
      db.collection('media').deleteMany({ testRun: runId }),
      db.collection('reels').deleteMany({ testRun: runId }),
      db.collection('user_blocks').deleteMany({ testRun: runId }),
      createdUserIds.length
        ? db.collection('reel_for_you_sessions').deleteMany({ userId: { $in: createdUserIds } })
        : Promise.resolve(),
      createdUserIds.length
        ? db.collection('discovery_candidate_tokens').deleteMany({ viewerUserId: { $in: createdUserIds } })
        : Promise.resolve(),
    ]);
    createdUserIds = [];
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('Reels Browse returns public seeded-shape reels with beta topics and keeps unsafe rows out', async () => {
    const fixture = await seedFixture();
    const response = await request(app)
      .get('/reels/browse?topic=campus_life')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);
    const ids = response.body.reels.map((reel: any) => reel.id);
    expect(ids).toContain(fixture.visibleReelId);
    expect(ids).not.toContain(fixture.privateReelId);
    expect(ids).not.toContain(fixture.deletedReelId);
    expect(ids).not.toContain(fixture.blockedReelId);
  });

  it('Reels For You falls back to eligible public seeded-shape reels for a new viewer', async () => {
    const fixture = await seedFixture();
    const response = await request(app)
      .get('/reels/for-you')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);
    const ids = response.body.reels.map((reel: any) => reel.id);
    expect(ids).toContain(fixture.visibleReelId);
    expect(ids).not.toContain(fixture.blockedReelId);
  });

  it('Profile Reels returns poster and thumbnail URLs for ready reels', async () => {
    const fixture = await seedFixture();
    const response = await request(app)
      .get(`/profiles/${fixture.creatorHandle}/reels`)
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);
    const reel = response.body.reels.find((item: any) => item.id === fixture.visibleReelId);
    expect(reel?.posterUrl).toBe(`/api/reels/${fixture.visibleReelId}/poster`);
    expect(reel?.thumbnailUrl).toBe(`/api/reels/${fixture.visibleReelId}/poster`);
  });
});
