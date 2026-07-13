import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createHmac } from 'crypto';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { User } from '../models/user';

function signTestToken(userId: string) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(
    JSON.stringify({
      userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    })
  ).toString('base64url');
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', process.env.JWT_ACCESS_SECRET!).update(data).digest('base64url');
  return `${data}.${signature}`;
}

describe('Profile invite links', () => {
  let inviterId: ObjectId;
  let inviterToken: string;
  let viewerId: ObjectId;
  let viewerToken: string;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    inviterId = new ObjectId();
    viewerId = new ObjectId();
    await db.collection<User>('users').insertMany([
      {
        _id: inviterId,
        username: `invite_inviter_${inviterId.toString()}`,
        email: `inviter_${inviterId.toString()}@example.com`,
        passwordHash: 'hashed_password',
        name: 'Inviter',
        profileVisibility: 'public',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User,
      {
        _id: viewerId,
        username: `invite_viewer_${viewerId.toString()}`,
        email: `viewer_${viewerId.toString()}@example.com`,
        passwordHash: 'hashed_password',
        name: 'Viewer',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User,
    ]);
    inviterToken = signTestToken(inviterId.toString());
    viewerToken = signTestToken(viewerId.toString());
  });

  it('requires authentication to create an invite', async () => {
    const response = await request(app).post('/invites');
    expect(response.status).toBe(401);
  });

  it('creates an invite with an unguessable token', async () => {
    const response = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);
    expect(response.status).toBe(201);
    expect(response.body.token).toBeDefined();
    // 24 random bytes, base64url-encoded: long enough that guessing is infeasible.
    expect(response.body.token.length).toBeGreaterThanOrEqual(32);
    expect(response.body.url).toContain(response.body.token);
  });

  it('two invites from the same user get different tokens', async () => {
    const first = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);
    const second = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);
    expect(first.body.token).not.toBe(second.body.token);
  });

  it('requires authentication to resolve an invite', async () => {
    const created = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);
    const response = await request(app).get(`/invites/${created.body.token}`);
    expect(response.status).toBe(401);
  });

  it('resolves a valid invite to the inviter\'s public profile', async () => {
    const created = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);
    const response = await request(app)
      .get(`/invites/${created.body.token}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.profile.username).toBe(`invite_inviter_${inviterId.toString()}`);
  });

  it('returns 404 for an unknown token', async () => {
    const response = await request(app)
      .get('/invites/not-a-real-token-at-all-00000000000000000000')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(response.status).toBe(404);
  });

  it('does not let an invite bypass a block between inviter and viewer', async () => {
    const created = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);

    await getDatabase().collection('user_blocks').insertOne({
      _id: new ObjectId(),
      blockerUserId: inviterId,
      blockedUserId: viewerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .get(`/invites/${created.body.token}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(404);
  });

  it('does not let an invite bypass a private profile\'s visibility rules', async () => {
    await getDatabase().collection('users').updateOne({ _id: inviterId }, { $set: { profileVisibility: 'private' } });
    const created = await request(app).post('/invites').set('Authorization', `Bearer ${inviterToken}`);

    const response = await request(app)
      .get(`/invites/${created.body.token}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.profile.locked).toBe(true);
  });
});
