import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Db, ObjectId } from 'mongodb';
import app from '../app';
import { closeDatabase, connectToDatabase, getDatabase } from '../db';
import { hashRefreshToken } from '../models/device-session';

let testDb: Db;

beforeAll(async () => {
  await connectToDatabase();
  testDb = getDatabase();
});

afterAll(async () => {
  if (testDb) await testDb.dropDatabase();
  await closeDatabase();
});

beforeEach(async () => {
  await testDb.collection('users').deleteMany({});
  await testDb.collection('deviceSessions').deleteMany({});
});

describe('GET /account/sessions', () => {
  it('returns only active non-revoked sessions in activity order with device metadata', async () => {
    const registration = await request(app).post('/register').send({
      username: 'sessionviewer',
      email: 'sessions@example.com',
      password: 'password123',
      name: 'Session Viewer',
    }).expect(201);

    const userId = new ObjectId(registration.body.user._id);
    const accessToken = registration.body.accessToken;
    const refreshCookie = registration.headers['set-cookie'][0].split(';')[0];
    const current = await testDb.collection('deviceSessions').findOne({ userId });
    expect(current).toBeTruthy();

    const now = new Date();
    await testDb.collection('deviceSessions').updateOne(
      { _id: current!._id },
      { $set: { lastActiveAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) } }
    );

    const recentId = new ObjectId();
    const olderId = new ObjectId();
    const common = {
      userId,
      refreshTokenHash: await hashRefreshToken('not-the-current-token'),
      ipAddress: '127.0.0.1',
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
    };

    await testDb.collection('deviceSessions').insertMany([
      {
        ...common,
        _id: recentId,
        userAgent: 'Mozilla/5.0 (Macintosh) Firefox/128.0',
        lastActiveAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
      {
        ...common,
        _id: olderId,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edg/128.0',
        lastActiveAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      },
      {
        ...common,
        _id: new ObjectId(),
        userAgent: 'Revoked Browser',
        revokedAt: now,
      },
      {
        ...common,
        _id: new ObjectId(),
        userAgent: 'Expired Browser',
        expiresAt: new Date(now.getTime() - 1),
      },
    ]);

    const response = await request(app)
      .get('/account/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie)
      .expect(200);

    expect(response.body.sessions.map(({ id }: { id: string }) => id)).toEqual([
      recentId.toString(),
      current!._id.toString(),
      olderId.toString(),
    ]);
    expect(response.body.sessions.every(({ status }: { status: string }) => status === 'active')).toBe(true);
    expect(response.body.sessions[0]).toMatchObject({
      label: 'Firefox on macOS',
      browser: 'Firefox',
      operatingSystem: 'macOS',
      deviceType: 'desktop',
      current: false,
    });
    expect(response.body.sessions[1].current).toBe(true);

    await request(app)
      .delete(`/account/sessions/${recentId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(await testDb.collection('deviceSessions').findOne({ _id: recentId })).toBeNull();

    const logoutOthers = await request(app)
      .post('/account/sessions/logout-others')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(logoutOthers.body.revoked).toBe(3);
    expect(await testDb.collection('deviceSessions').countDocuments({ userId })).toBe(1);
    expect(await testDb.collection('deviceSessions').findOne({ _id: current!._id })).toBeTruthy();
  });
});
