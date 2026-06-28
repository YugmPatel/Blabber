import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';

vi.mock('@repo/utils', async () => {
  const actual = await vi.importActual<typeof import('@repo/utils')>('@repo/utils');
  return {
    ...actual,
    createAuthMiddleware: () => (req: any, _res: any, next: any) => {
      req.user = { userId: req.get('x-user-id') };
      next();
    },
  };
});

vi.mock('../pubsub', () => ({
  getPubSub: () => ({ publish: vi.fn().mockResolvedValue(undefined) }),
}));

import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

describe('group invite links', () => {
  const owner = new ObjectId();
  const admin = new ObjectId();
  const member = new ObjectId();
  const joiner = new ObjectId();
  const chatId = new ObjectId();
  const directId = new ObjectId();

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('users').deleteMany({});
    await db.collection('chats').deleteMany({});
    await db.collection('groupInviteLinks').deleteMany({});
    await db.collection('users').insertMany([owner, admin, member, joiner].map((_id) => ({ _id, name: _id.toString() })));
    await db.collection('chats').insertMany([
      {
        _id: chatId,
        type: 'group',
        participants: [owner, admin, member],
        admins: [owner, admin],
        ownerId: owner,
        title: 'Invite Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: directId,
        type: 'direct',
        participants: [owner, member],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  it('allows owner/admin management, denies members/direct chats, and stores only token hash', async () => {
    const denied = await request(app)
      .post(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', member.toString())
      .send({ expiresIn: 'never', maxUses: 'unlimited' });
    expect(denied.status).toBe(403);

    const direct = await request(app)
      .post(`/${directId.toString()}/invite-link`)
      .set('x-user-id', owner.toString())
      .send({ expiresIn: 'never', maxUses: 'unlimited' });
    expect(direct.status).toBe(400);

    const created = await request(app)
      .post(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', owner.toString())
      .send({ expiresIn: 'never', maxUses: 10 });
    expect(created.status).toBe(201);
    expect(created.body.token).toEqual(expect.any(String));

    const token = created.body.token;
    const hash = hashToken(token);
    expect(await getDatabase().collection('groupInviteLinks').countDocuments({ tokenHash: token })).toBe(0);
    expect(await getDatabase().collection('groupInviteLinks').countDocuments({ tokenHash: hash })).toBe(1);

    const settings = await request(app)
      .get(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', admin.toString());
    expect(settings.status).toBe(200);
    expect(settings.body.token).toBeUndefined();
  });

  it('previews and joins authenticated users as standard members without consuming already-member uses', async () => {
    const created = await request(app)
      .post(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', owner.toString())
      .send({ expiresIn: 'never', maxUses: 10 });
    const token = created.body.token;

    const preview = await request(app)
      .get(`/invites/${token}/preview`)
      .set('x-user-id', joiner.toString());
    expect(preview.status).toBe(200);
    expect(preview.body.invite.groupName).toBe('Invite Group');

    const join = await request(app)
      .post(`/invites/${token}/join`)
      .set('x-user-id', joiner.toString());
    expect(join.status).toBe(200);
    expect(join.body.chat.participants).toContain(joiner.toString());
    expect(join.body.chat.admins).not.toContain(joiner.toString());

    const countAfterJoin = (await getDatabase().collection('groupInviteLinks').findOne({ tokenHash: hashToken(token) }))?.useCount;
    await request(app).post(`/invites/${token}/join`).set('x-user-id', member.toString());
    const countAfterExisting = (await getDatabase().collection('groupInviteLinks').findOne({ tokenHash: hashToken(token) }))?.useCount;
    expect(countAfterExisting).toBe(countAfterJoin);
  });

  it('fails revoked, expired, and exhausted links safely', async () => {
    const created = await request(app)
      .post(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', owner.toString())
      .send({ expiresIn: 'never', maxUses: 10 });
    const token = created.body.token;
    await request(app).post(`/${chatId.toString()}/invite-link/revoke`).set('x-user-id', owner.toString());
    expect((await request(app).get(`/invites/${token}/preview`).set('x-user-id', joiner.toString())).status).toBe(404);

    const expired = await request(app)
      .post(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', owner.toString())
      .send({ expiresIn: 'never', maxUses: 10 });
    await getDatabase().collection('groupInviteLinks').updateOne(
      { tokenHash: hashToken(expired.body.token) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    expect((await request(app).get(`/invites/${expired.body.token}/preview`).set('x-user-id', joiner.toString())).status).toBe(404);

    await request(app).post(`/${chatId.toString()}/invite-link/revoke`).set('x-user-id', owner.toString());
    const exhausted = await request(app)
      .post(`/${chatId.toString()}/invite-link`)
      .set('x-user-id', owner.toString())
      .send({ expiresIn: 'never', maxUses: 10 });
    await getDatabase().collection('groupInviteLinks').updateOne(
      { tokenHash: hashToken(exhausted.body.token) },
      { $set: { useCount: 10 } }
    );
    expect((await request(app).post(`/invites/${exhausted.body.token}/join`).set('x-user-id', joiner.toString())).status).toBe(404);
  });
});
