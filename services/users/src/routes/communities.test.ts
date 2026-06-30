import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createHmac } from 'crypto';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

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

describe('Release D communities', () => {
  let ownerId: ObjectId;
  let memberId: ObjectId;
  let strangerId: ObjectId;
  let ownerToken: string;
  let memberToken: string;
  let strangerToken: string;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('users').deleteMany({ username: /^rdcommunity-/ });
    await db.collection('communities').deleteMany({});
    await db.collection('community_memberships').deleteMany({});
    await db.collection('community_join_requests').deleteMany({});
    await db.collection('community_bans').deleteMany({});
    await db.collection('community_invites').deleteMany({});
    await db.collection('community_posts').deleteMany({});
    await db.collection('community_post_comments').deleteMany({});
    await db.collection('community_post_reactions').deleteMany({});
    await db.collection('community_handle_reservations').deleteMany({});
    await db.collection('community_moderation_activity').deleteMany({});
    await db.collection('user_blocks').deleteMany({});

    const now = new Date();
    const result = await db.collection('users').insertMany([
      {
        username: 'rdcommunity-owner',
        email: 'rdcommunity-owner@example.com',
        passwordHash: 'hashed',
        name: 'Community Owner',
        emailVerified: true,
        profileHandle: 'rdcommunity_owner',
        profileVisibility: 'public',
        contacts: [],
        blocked: [],
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        username: 'rdcommunity-member',
        email: 'rdcommunity-member@example.com',
        passwordHash: 'hashed',
        name: 'Community Member',
        emailVerified: true,
        profileHandle: 'rdcommunity_member',
        profileVisibility: 'public',
        contacts: [],
        blocked: [],
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        username: 'rdcommunity-stranger',
        email: 'rdcommunity-stranger@example.com',
        passwordHash: 'hashed',
        name: 'Community Stranger',
        emailVerified: true,
        profileHandle: 'rdcommunity_stranger',
        profileVisibility: 'public',
        contacts: [],
        blocked: [],
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    [ownerId, memberId, strangerId] = Object.values(result.insertedIds);
    ownerToken = signTestToken(ownerId.toString());
    memberToken = signTestToken(memberId.toString());
    strangerToken = signTestToken(strangerId.toString());
  });

  it('creates open communities with separate owner membership', async () => {
    const created = await request(app)
      .post('/communities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Test Community', handle: 'rdcommunity_open', membershipMode: 'open', postingPolicy: 'everyone' });

    expect(created.status).toBe(201);
    expect(created.body.community.membership.role).toBe('owner');
    const chat = await getDatabase().collection('chats').findOne({ title: 'Test Community' });
    expect(chat).toBeNull();
  });

  it('keeps private communities unavailable to nonmembers but accepts hashed invites', async () => {
    await request(app)
      .post('/communities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Private Community', handle: 'rdcommunity_private', membershipMode: 'private', postingPolicy: 'everyone' });

    const denied = await request(app).get('/communities/rdcommunity_private').set('Authorization', `Bearer ${strangerToken}`);
    expect(denied.status).toBe(404);

    const invite = await request(app)
      .post('/communities/rdcommunity_private/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expiresIn: '7d', maxUses: 10 });
    expect(invite.status).toBe(201);
    expect(invite.body.token).toBeTruthy();

    const storedInvite = await getDatabase().collection('community_invites').findOne({});
    expect(storedInvite?.tokenHash).toBeTruthy();
    expect(storedInvite?.tokenHash).not.toBe(invite.body.token);

    const accepted = await request(app)
      .post(`/communities/invite/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.community.membership.role).toBe('member');
  });

  it('keeps community posts out of profile feed posts', async () => {
    await request(app)
      .post('/communities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Post Community', handle: 'rdcommunity_posts', membershipMode: 'open', postingPolicy: 'everyone' });
    await request(app).post('/communities/rdcommunity_posts/join').set('Authorization', `Bearer ${memberToken}`);

    const created = await request(app)
      .post('/communities/rdcommunity_posts/posts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'community only' });
    expect(created.status).toBe(201);

    const profilePosts = await getDatabase().collection('posts').find({ authorUserId: ownerId }).toArray();
    expect(profilePosts).toHaveLength(0);
  });

  it('enforces blocking against shared community content', async () => {
    await request(app)
      .post('/communities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Block Community', handle: 'rdcommunity_block', membershipMode: 'open', postingPolicy: 'everyone' });
    await request(app).post('/communities/rdcommunity_block/join').set('Authorization', `Bearer ${memberToken}`);
    const created = await request(app)
      .post('/communities/rdcommunity_block/posts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'blocked content' });
    expect(created.status).toBe(201);

    await getDatabase().collection('user_blocks').insertOne({
      _id: new ObjectId(),
      blockerUserId: ownerId,
      blockedUserId: memberId,
      createdAt: new Date(),
    });

    const denied = await request(app)
      .get(`/community-posts/${created.body.post.id}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(denied.status).toBe(404);
  });
});
