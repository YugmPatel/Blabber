import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createHmac } from 'crypto';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { User } from '../models/user';

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

describe('Release D profiles', () => {
  let ownerId: ObjectId;
  let viewerId: ObjectId;
  let otherId: ObjectId;
  let ownerToken: string;
  let viewerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('users').deleteMany({ username: /^rdprofile-/ });
    await db.collection('profile_handle_reservations').deleteMany({});
    // Intentionally not clearing profile_relationships/user_blocks here: this
    // file's user IDs are freshly randomized every run, so stale rows from
    // other tests can never match them. An unconditional deleteMany({}) on a
    // shared collection races with other test files that run concurrently
    // against the same database (confirmed: it was intermittently wiping out
    // a block row that search.test.ts had just inserted).

    const now = new Date();
    const result = await db.collection<User>('users').insertMany([
      {
        username: 'rdprofile-owner',
        email: 'rdprofile-owner@example.com',
        passwordHash: 'hashed',
        name: 'Profile Owner',
        profileHandle: 'owner_test',
        profileBio: 'private bio',
        profileWebsite: 'https://example.com/',
        profileVisibility: 'private',
        contacts: [],
        blocked: [],
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        username: 'rdprofile-viewer',
        email: 'rdprofile-viewer@example.com',
        passwordHash: 'hashed',
        name: 'Profile Viewer',
        profileHandle: 'viewer_test',
        profileVisibility: 'private',
        contacts: [],
        blocked: [],
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        username: 'rdprofile-other',
        email: 'rdprofile-other@example.com',
        passwordHash: 'hashed',
        name: 'Profile Other',
        profileHandle: 'other_test',
        profileVisibility: 'public',
        contacts: [],
        blocked: [],
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      },
    ] as User[]);

    [ownerId, viewerId, otherId] = Object.values(result.insertedIds);
    ownerToken = signTestToken(ownerId.toString());
    viewerToken = signTestToken(viewerId.toString());
    otherToken = signTestToken(otherId.toString());
  });

  it('keeps private profile details locked until request approval', async () => {
    const locked = await request(app).get('/profiles/owner_test').set('Authorization', `Bearer ${viewerToken}`);
    expect(locked.status).toBe(200);
    expect(locked.body.profile.locked).toBe(true);
    expect(locked.body.profile.bio).toBeUndefined();

    const requested = await request(app).post('/profiles/owner_test/follow').set('Authorization', `Bearer ${viewerToken}`);
    expect(requested.status).toBe(200);
    expect(requested.body.profile.relationship).toBe('requested_outgoing');
    expect(requested.body.profile.bio).toBeUndefined();

    const incoming = await request(app).get('/profiles/requests/incoming').set('Authorization', `Bearer ${ownerToken}`);
    expect(incoming.body.requests).toHaveLength(1);
    expect(incoming.body.requests[0].requester.handle).toBe('viewer_test');

    const approved = await request(app)
      .post('/profiles/requests/viewer_test/approve')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(approved.status).toBe(200);

    const full = await request(app).get('/profiles/owner_test').set('Authorization', `Bearer ${viewerToken}`);
    expect(full.body.profile.relationship).toBe('following');
    expect(full.body.profile.bio).toBe('private bio');
    expect(full.body.profile.website).toBe('https://example.com/');
  });

  it('allows public profiles to be followed immediately', async () => {
    const followed = await request(app).post('/profiles/other_test/follow').set('Authorization', `Bearer ${viewerToken}`);
    expect(followed.status).toBe(200);
    expect(followed.body.profile.relationship).toBe('following');
    const rel = await getDatabase().collection('profile_relationships').findOne({ followerUserId: viewerId, targetUserId: otherId });
    expect(rel?.state).toBe('following');
  });

  it('revokes relationships when a user is blocked', async () => {
    await getDatabase().collection('profile_relationships').insertOne({
      _id: new ObjectId(),
      followerUserId: viewerId,
      targetUserId: ownerId,
      state: 'following',
      createdAt: new Date(),
      updatedAt: new Date(),
      approvedAt: new Date(),
    });

    const blocked = await request(app).post('/block').set('Authorization', `Bearer ${ownerToken}`).send({ userId: viewerId.toString() });
    expect(blocked.status).toBe(200);

    const rel = await getDatabase().collection('profile_relationships').findOne({ followerUserId: viewerId, targetUserId: ownerId });
    expect(rel).toBeNull();
    const denied = await request(app).get('/profiles/owner_test').set('Authorization', `Bearer ${viewerToken}`);
    expect(denied.status).toBe(404);
  });

  it('validates handles and enforces cooldown', async () => {
    const reserved = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ handle: 'admin' });
    expect(reserved.status).toBe(400);

    const changed = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ handle: 'owner_next' });
    expect(changed.status).toBe(200);
    expect(changed.body.profile.handle).toBe('owner_next');

    const cooldown = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ handle: 'owner_again' });
    expect(cooldown.status).toBe(429);
  });

  it('allows an OAuth-style user without an existing handle to save their first username and rejects duplicates', async () => {
    await getDatabase().collection('users').updateOne(
      { _id: viewerId },
      {
        $unset: { profileHandle: '' },
        $set: { googleId: 'google-viewer', profileHandleChangedAt: new Date(), updatedAt: new Date() },
      } as any
    );

    const firstHandle = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ handle: '@yugmpatel' });
    expect(firstHandle.status).toBe(200);
    expect(firstHandle.body.profile.handle).toBe('yugmpatel');

    const duplicate = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ handle: 'owner_test' });
    expect(duplicate.status).toBe(409);

    const cooldown = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ handle: 'other_test' });
    expect(cooldown.status).toBe(429);

    const invalid = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ handle: '1_bad' });
    expect(invalid.status).toBe(400);
  });

  it('saves a handle with empty optional profile fields without creating Mongo update conflicts', async () => {
    await getDatabase().collection('users').updateOne(
      { _id: viewerId },
      {
        $unset: { profileBio: '', profileHandle: '', profileWebsite: '' },
        $set: { googleId: 'google-empty-profile-viewer', profileHandleChangedAt: new Date(), updatedAt: new Date() },
      } as any
    );

    const emptyProfile = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Profile Viewer',
        bio: '',
        profileBio: '',
        website: '',
        visibility: 'public',
      });
    expect(emptyProfile.status).toBe(200);
    expect(emptyProfile.body.profile).toMatchObject({
      name: 'Profile Viewer',
      bio: '',
      website: null,
      visibility: 'public',
    });

    const firstHandle = await request(app)
      .patch('/profiles/me/handle')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ handle: 'yugm_patel' });
    expect(firstHandle.status).toBe(200);
    expect(firstHandle.body.profile.handle).toBe('yugm_patel');

    const user = await getDatabase().collection<User>('users').findOne({ _id: viewerId });
    expect(user?.profileBio).toBeUndefined();
    expect(user?.profileWebsite).toBeUndefined();
    expect(user?.profileHandle).toBe('yugm_patel');
  });

  it('saves profile fields used by Edit Profile, including relative local avatar URLs', async () => {
    const basic = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Updated Viewer',
        about: 'Demo-ready note',
        role: 'Designer',
        department: 'Product',
        avatarUrl: '/api/media/local/507f1f77bcf86cd799439011',
      });
    expect(basic.status).toBe(200);
    expect(basic.body.user).toMatchObject({
      name: 'Updated Viewer',
      about: 'Demo-ready note',
      role: 'Designer',
      department: 'Product',
      avatarUrl: '/api/media/local/507f1f77bcf86cd799439011',
    });

    const social = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Updated Viewer',
        bio: 'Public demo bio',
        website: 'https://example.com/profile',
        visibility: 'public',
      });
    expect(social.status).toBe(200);
    expect(social.body.profile).toMatchObject({
      name: 'Updated Viewer',
      bio: 'Public demo bio',
      website: 'https://example.com/profile',
      visibility: 'public',
    });
  });

  it('approves and declines follow requests by requester id when requester has no handle', async () => {
    await getDatabase().collection('users').updateOne({ _id: viewerId }, { $unset: { profileHandle: '' } } as any);

    const requested = await request(app).post('/profiles/owner_test/follow').set('Authorization', `Bearer ${viewerToken}`);
    expect(requested.status).toBe(200);
    expect(requested.body.profile.relationship).toBe('requested_outgoing');

    const incoming = await request(app).get('/profiles/requests/incoming').set('Authorization', `Bearer ${ownerToken}`);
    expect(incoming.body.requests).toHaveLength(1);
    expect(incoming.body.requests[0].requester.id).toBe(viewerId.toString());
    expect(incoming.body.requests[0].requester.handle).toBeNull();

    const approved = await request(app)
      .post(`/profiles/requests/${viewerId.toString()}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(approved.status).toBe(200);

    const duplicateApprove = await request(app)
      .post(`/profiles/requests/${viewerId.toString()}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(duplicateApprove.status).toBe(200);

    const afterApprove = await getDatabase().collection('profile_relationships').findOne({ followerUserId: viewerId, targetUserId: ownerId });
    expect(afterApprove?.state).toBe('following');
    expect(await getDatabase().collection('profile_relationships').countDocuments({ targetUserId: ownerId, state: 'following' })).toBe(1);

    await getDatabase().collection('profile_relationships').updateOne(
      { followerUserId: viewerId, targetUserId: ownerId },
      { $set: { state: 'requested', updatedAt: new Date() }, $unset: { approvedAt: '' } }
    );
    const declined = await request(app)
      .post(`/profiles/requests/${viewerId.toString()}/decline`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(declined.status).toBe(200);
    const duplicateDecline = await request(app)
      .post(`/profiles/requests/${viewerId.toString()}/decline`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(duplicateDecline.status).toBe(200);
    expect(await getDatabase().collection('profile_relationships').findOne({ followerUserId: viewerId, targetUserId: ownerId })).toBeNull();
  });

  it('does not expose blocked or incoming relationship state to unrelated viewers', async () => {
    await getDatabase().collection('profile_relationships').insertOne({
      _id: new ObjectId(),
      followerUserId: ownerId,
      targetUserId: viewerId,
      state: 'requested',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await request(app).get('/profiles/viewer_test').set('Authorization', `Bearer ${otherToken}`);
    expect(response.status).toBe(200);
    expect(response.body.profile.relationship).toBe('none');
    expect(response.body.profile.locked).toBe(true);
  });
});
