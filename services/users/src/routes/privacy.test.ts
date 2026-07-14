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

describe('GET/PATCH /me/privacy', () => {
  let userId: ObjectId;
  let token: string;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    userId = new ObjectId();
    await db.collection<User>('users').insertOne({
      _id: userId,
      username: `privacy_test_${userId.toString()}`,
      email: `privacy_${userId.toString()}@example.com`,
      passwordHash: 'hashed_password',
      name: 'Privacy Test User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);
    token = signTestToken(userId.toString());
  });

  it('requires authentication for GET', async () => {
    const response = await request(app).get('/me/privacy');
    expect(response.status).toBe(401);
  });

  it('requires authentication for PATCH', async () => {
    const response = await request(app).patch('/me/privacy').send({ messagePermission: 'everyone' });
    expect(response.status).toBe(401);
  });

  it('returns safe defaults for a user with no saved settings', async () => {
    const response = await request(app).get('/me/privacy').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.privacy).toMatchObject({
      profileVisibility: 'private',
      searchVisibility: 'everyone',
      emailDiscoverability: 'nobody',
      // Conservative P0 default: unlike the other permissions, new users
      // default to message requests rather than open direct messaging.
      messagePermission: 'followers',
      groupAddPermission: 'everyone',
      callPermission: 'everyone',
    });
  });

  it('rejects an invalid messagePermission value', async () => {
    const response = await request(app)
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${token}`)
      .send({ messagePermission: 'contacts' }); // not a valid messagePermission value

    expect(response.status).toBe(400);
  });

  it('rejects an invalid emailDiscoverability value', async () => {
    const response = await request(app)
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${token}`)
      .send({ emailDiscoverability: 'everyone' });

    expect(response.status).toBe(400);
  });

  it('rejects an invalid profileVisibility value', async () => {
    const response = await request(app)
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${token}`)
      .send({ profileVisibility: 'signed_in' });

    expect(response.status).toBe(400);
  });

  it('rejects an invalid callPermission value', async () => {
    const response = await request(app)
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${token}`)
      .send({ callPermission: 'contacts' });

    expect(response.status).toBe(400);
  });

  it('persists valid updates and enforces them for later reads', async () => {
    const update = await request(app)
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messagePermission: 'no_one',
        searchVisibility: 'no_one',
        emailDiscoverability: 'exact_match',
        callPermission: 'no_one',
      });

    expect(update.status).toBe(200);
    expect(update.body.privacy).toMatchObject({
      messagePermission: 'no_one',
      searchVisibility: 'no_one',
      emailDiscoverability: 'exact_match',
      callPermission: 'no_one',
    });

    const reread = await request(app).get('/me/privacy').set('Authorization', `Bearer ${token}`);
    expect(reread.body.privacy).toMatchObject({
      messagePermission: 'no_one',
      searchVisibility: 'no_one',
      emailDiscoverability: 'exact_match',
      callPermission: 'no_one',
    });
  });

  it('a user cannot change another user\'s privacy settings', async () => {
    const otherId = new ObjectId();
    await getDatabase().collection<User>('users').insertOne({
      _id: otherId,
      username: `privacy_other_${otherId.toString()}`,
      email: `privacy_other_${otherId.toString()}@example.com`,
      passwordHash: 'hashed_password',
      name: 'Other User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    // Only the authenticated user's own id is ever used server-side; there is
    // no request field that can target another user's settings.
    await request(app)
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${token}`)
      .send({ messagePermission: 'no_one' });

    const otherSettings = await getDatabase().collection('userSettings').findOne({ userId: otherId });
    expect(otherSettings).toBeNull();
  });
});
