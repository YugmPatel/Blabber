import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'crypto';
import { ObjectId } from 'mongodb';
import app from '../app';
import { closeDatabase, connectToDatabase, getDatabase } from '../db';

const runId = `beta-visible-${new ObjectId().toString()}`;

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

async function insertPost(authorUserId: ObjectId, suffix: string, extra: Record<string, unknown> = {}) {
  const db = getDatabase();
  const now = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const mediaId = new ObjectId();
  const postId = new ObjectId();
  await db.collection('media').insertOne({
    _id: mediaId,
    userId: authorUserId,
    fileName: `${suffix}.jpg`,
    originalFileName: `${suffix}.jpg`,
    fileType: 'image/jpeg',
    detectedFileType: 'image/jpeg',
    fileSize: 2048,
    status: 'approved',
    storage: 'local',
    s3Key: `${runId}/${suffix}.jpg`,
    createdAt: now,
    uploadedAt: now,
    approvedAt: now,
    testRun: runId,
  });
  await db.collection('posts').insertOne({
    _id: postId,
    authorUserId,
    body: `Beta visible post ${suffix}`,
    visibility: 'public',
    mediaIds: [mediaId],
    commentCount: 0,
    reactionCounts: {},
    discoverable: true,
    discoveryTopicIds: ['campus_life'],
    discoverableUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    testRun: runId,
    ...extra,
  });
  return postId.toString();
}

async function seedFixture() {
  const db = getDatabase();
  const viewerId = new ObjectId();
  const creatorId = new ObjectId();
  const blockedCreatorId = new ObjectId();
  const now = new Date();
  await db.collection('users').insertMany([
    userDoc(viewerId, `${runId}-viewer`),
    userDoc(creatorId, `${runId}-creator`, {
      creatorDiscoveryEnabled: true,
      creatorDiscoveryEnabledAt: now,
      creatorTopicIds: ['campus_life'],
      discoveryShowPosts: true,
    }),
    userDoc(blockedCreatorId, `${runId}-blocked`, {
      creatorDiscoveryEnabled: true,
      creatorDiscoveryEnabledAt: now,
      creatorTopicIds: ['campus_life'],
      discoveryShowPosts: true,
    }),
  ]);
  const visiblePostId = await insertPost(creatorId, 'eligible');
  const privatePostId = await insertPost(creatorId, 'private', { visibility: 'followers' });
  const deletedPostId = await insertPost(creatorId, 'deleted', { deletedAt: now });
  const blockedPostId = await insertPost(blockedCreatorId, 'blocked');
  await db.collection('user_blocks').insertOne({
    _id: new ObjectId(),
    blockerUserId: blockedCreatorId,
    blockedUserId: viewerId,
    createdAt: now,
    testRun: runId,
  });
  return {
    token: signTestToken(viewerId.toString()),
    visiblePostId,
    privatePostId,
    deletedPostId,
    blockedPostId,
  };
}

describe('beta seed public visibility', () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterEach(async () => {
    const db = getDatabase();
    await Promise.all([
      db.collection('users').deleteMany({ username: new RegExp(`^${runId}`) }),
      db.collection('posts').deleteMany({ testRun: runId }),
      db.collection('media').deleteMany({ testRun: runId }),
      db.collection('user_blocks').deleteMany({ testRun: runId }),
    ]);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('Feed Featured returns seeded-shape public posts while excluding private, deleted, and blocked content', async () => {
    const fixture = await seedFixture();
    const response = await request(app)
      .get('/feed?mode=featured')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);
    const ids = response.body.posts.map((post: any) => post.id);
    expect(ids).toContain(fixture.visiblePostId);
    expect(ids).not.toContain(fixture.privatePostId);
    expect(ids).not.toContain(fixture.deletedPostId);
    expect(ids).not.toContain(fixture.blockedPostId);
  });

  it('Discover browse and For You return seeded-shape public posts for a new viewer', async () => {
    const fixture = await seedFixture();
    const browse = await request(app)
      .get('/discovery/posts')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);
    expect(browse.body.posts.map((post: any) => post.id)).toContain(fixture.visiblePostId);

    const forYou = await request(app)
      .get('/discovery/for-you')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);
    const ids = forYou.body.posts.map((post: any) => post.id);
    expect(ids).toContain(fixture.visiblePostId);
    expect(ids).not.toContain(fixture.blockedPostId);
  });
});
