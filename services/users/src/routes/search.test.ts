import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createHmac } from 'crypto';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { User, createUserIndexes } from '../models/user';

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

describe('GET /search - User Search', () => {
  let viewerId: ObjectId;
  let viewerToken: string;
  let testUser1Id: ObjectId;
  let testUser2Id: ObjectId;
  let testUser3Id: ObjectId;

  beforeAll(async () => {
    await connectToDatabase();
    await createUserIndexes();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    const usersCollection = db.collection<User>('users');

    await usersCollection.deleteMany({ username: /^test-search-/ });
    // Not clearing user_blocks/userSettings/message_requests here: this
    // file's IDs are freshly randomized every run, so nothing else can ever
    // match them, and an unconditional deleteMany({}) on a shared collection
    // races with other test files running concurrently against the same
    // database.

    viewerId = new ObjectId();
    await usersCollection.insertOne({
      _id: viewerId,
      username: 'test-search-viewer',
      email: 'viewer@example.com',
      passwordHash: 'hashed_password',
      name: 'Viewer User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);
    viewerToken = signTestToken(viewerId.toString());

    const testUsers: Partial<User>[] = [
      {
        username: 'test-search-alice',
        email: 'alice@example.com',
        passwordHash: 'hashed_password',
        name: 'Alice Johnson',
        avatarUrl: 'https://example.com/alice.jpg',
        about: 'Software developer',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        username: 'test-search-bob',
        email: 'bob@example.com',
        passwordHash: 'hashed_password',
        name: 'Bob Smith',
        avatarUrl: 'https://example.com/bob.jpg',
        about: 'Designer',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        username: 'test-search-charlie',
        email: 'charlie@example.com',
        passwordHash: 'hashed_password',
        name: 'Charlie Brown',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await usersCollection.insertMany(testUsers as User[]);
    const insertedIds = Object.values(result.insertedIds);
    testUser1Id = insertedIds[0];
    testUser2Id = insertedIds[1];
    testUser3Id = insertedIds[2];
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/search').query({ q: 'alice' });
    expect(response.status).toBe(401);
  });

  it('rejects a query shorter than the minimum length', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'a' });

    expect(response.status).toBe(400);
  });

  it('does not return all users for an empty query', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: '   ' });

    expect(response.status).toBe(400);
  });

  it('missing query parameter is rejected, not treated as list-all', async () => {
    const response = await request(app).get('/search').set('Authorization', `Bearer ${viewerToken}`);
    expect(response.status).toBe(400);
  });

  it('searches users by username', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'alice' });

    expect(response.status).toBe(200);
    const aliceUser = response.body.users.find((u: any) => u.username === 'test-search-alice');
    expect(aliceUser).toBeDefined();
    expect(aliceUser.displayName).toBe('Alice Johnson');
  });

  it('searches users by display name', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'Bob' });

    expect(response.status).toBe(200);
    const bobUser = response.body.users.find((u: any) => u.username === 'test-search-bob');
    expect(bobUser).toBeDefined();
  });

  it('excludes the current user from results', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'viewer' });

    expect(response.status).toBe(200);
    expect(response.body.users.find((u: any) => u.id === viewerId.toString())).toBeUndefined();
  });

  it('returns an empty array for no matches', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'nonexistentxyz' });

    expect(response.status).toBe(200);
    expect(response.body.users).toEqual([]);
  });

  it('does not expose email or other sensitive fields', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'alice' });

    expect(response.status).toBe(200);
    const aliceUser = response.body.users.find((u: any) => u.username === 'test-search-alice');
    expect(aliceUser).toBeDefined();
    expect(aliceUser.email).toBeUndefined();
    expect(aliceUser.passwordHash).toBeUndefined();
    expect(aliceUser.googleId).toBeUndefined();
    expect(aliceUser.contacts).toBeUndefined();
    expect(aliceUser.blocked).toBeUndefined();
    expect(Object.keys(aliceUser).sort()).toEqual(
      [
        'id',
        'username',
        'displayName',
        'avatarUrl',
        'bioPreview',
        'isVerified',
        'relationshipStatus',
        'canMessage',
        'requiresMessageRequest',
      ].sort()
    );
  });

  it('excludes a user the viewer blocked', async () => {
    await getDatabase().collection('user_blocks').insertOne({
      _id: new ObjectId(),
      blockerUserId: viewerId,
      blockedUserId: testUser2Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'Bob' });

    expect(response.status).toBe(200);
    expect(response.body.users.find((u: any) => u.username === 'test-search-bob')).toBeUndefined();
  });

  it('excludes a user who blocked the viewer', async () => {
    await getDatabase().collection('user_blocks').insertOne({
      _id: new ObjectId(),
      blockerUserId: testUser2Id,
      blockedUserId: viewerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'Bob' });

    expect(response.status).toBe(200);
    expect(response.body.users.find((u: any) => u.username === 'test-search-bob')).toBeUndefined();
  });

  it('respects a "no one can find me" search-visibility setting', async () => {
    await getDatabase().collection('users').updateOne(
      { _id: testUser1Id },
      { $set: { usernameFindability: 'no_one' } }
    );

    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'alice' });

    expect(response.status).toBe(200);
    expect(response.body.users.find((u: any) => u.username === 'test-search-alice')).toBeUndefined();
  });

  it('caps the limit server-side', async () => {
    const response = await request(app)
      .get('/search')
      .set('Authorization', `Bearer ${viewerToken}`)
      .query({ q: 'test-search', limit: 999 });

    expect(response.status).toBe(200);
    expect(response.body.users.length).toBeLessThanOrEqual(20);
  });
});
