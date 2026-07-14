import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createHmac } from 'crypto';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { seedChatUsers } from '../test-fixtures';

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

describe('Message requests', () => {
  let senderId: ObjectId;
  let recipientId: ObjectId;
  let senderToken: string;
  let recipientToken: string;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('message_requests').deleteMany({});
    await db.collection('chats').deleteMany({});
    await db.collection('userSettings').deleteMany({});
    await db.collection('user_blocks').deleteMany({});
    await db.collection('profile_relationships').deleteMany({});

    senderId = new ObjectId();
    recipientId = new ObjectId();
    await seedChatUsers([senderId, recipientId]);
    senderToken = signTestToken(senderId.toString());
    recipientToken = signTestToken(recipientId.toString());

    // Recipient only accepts messages from followers/requests, not everyone,
    // so a request (not an immediate chat) is the expected path in most of
    // these tests.
    await db.collection('userSettings').insertOne({
      userId: recipientId,
      messagePrivacy: 'followers',
    } as any);
  });

  it('requires authentication', async () => {
    const response = await request(app).post('/message-requests').send({ recipientId: recipientId.toString() });
    expect(response.status).toBe(401);
  });

  it('always uses the authenticated user as sender, never a client-supplied one', async () => {
    const impersonatedId = new ObjectId();
    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString(), senderId: impersonatedId.toString() });

    expect(response.status).toBe(201);
    const stored = await getDatabase().collection('message_requests').findOne({ recipientId });
    expect(stored?.senderId.toString()).toBe(senderId.toString());
    expect(stored?.senderId.toString()).not.toBe(impersonatedId.toString());
  });

  it('rejects a request to yourself', async () => {
    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: senderId.toString() });

    expect(response.status).toBe(400);
  });

  it('creates a pending request for a stranger with no privacy settings configured at all (conservative P0 default)', async () => {
    await getDatabase().collection('userSettings').deleteMany({ userId: recipientId });

    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    const chat = await getDatabase().collection('chats').findOne({
      type: 'direct',
      participants: { $all: [senderId, recipientId] },
    });
    expect(chat).toBeNull();
  });

  it('creates a pending request when the recipient requires one', async () => {
    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString(), introMessage: 'Hi there!' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    expect(response.body.request.introMessage).toBe('Hi there!');
  });

  it('opens a chat immediately when the recipient allows everyone', async () => {
    await getDatabase().collection('userSettings').updateOne({ userId: recipientId }, { $set: { messagePrivacy: 'everyone' } });

    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('accepted');
    expect(response.body.chat).toBeDefined();
    const pending = await getDatabase().collection('message_requests').findOne({ senderId, recipientId });
    expect(pending).toBeNull();
  });

  it('rejects duplicate pending requests', async () => {
    const first = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });

    expect(second.status).toBe(409);
  });

  it('blocks a request when the recipient does not accept messages from anyone', async () => {
    await getDatabase().collection('userSettings').updateOne({ userId: recipientId }, { $set: { messagePrivacy: 'no_one' } });

    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });

    expect(response.status).toBe(403);
  });

  it('blocks a request when either user has blocked the other', async () => {
    await getDatabase().collection('user_blocks').insertOne({
      _id: new ObjectId(),
      blockerUserId: recipientId,
      blockedUserId: senderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });

    expect(response.status).toBe(403);
    const stored = await getDatabase().collection('message_requests').findOne({ senderId, recipientId });
    expect(stored).toBeNull();
  });

  it('accepting a request creates a real conversation the recipient can use', async () => {
    const created = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });
    const requestId = created.body.request.id;

    const accepted = await request(app)
      .post(`/message-requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${recipientToken}`);

    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('accepted');
    expect(accepted.body.chat.type).toBe('direct');

    const chat = await getDatabase().collection('chats').findOne({ _id: new ObjectId(accepted.body.chat._id) });
    expect(chat).toBeDefined();
    expect(chat?.participants.map((id: ObjectId) => id.toString()).sort()).toEqual(
      [senderId.toString(), recipientId.toString()].sort()
    );
  });

  it('declining a request does not create a conversation', async () => {
    const created = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });
    const requestId = created.body.request.id;

    const declined = await request(app)
      .post(`/message-requests/${requestId}/decline`)
      .set('Authorization', `Bearer ${recipientToken}`);

    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('declined');

    const chat = await getDatabase().collection('chats').findOne({
      type: 'direct',
      participants: { $all: [senderId, recipientId] },
    });
    expect(chat).toBeNull();
  });

  it('only the recipient can accept or decline their own request', async () => {
    const created = await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString() });
    const requestId = created.body.request.id;

    const response = await request(app)
      .post(`/message-requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${senderToken}`); // sender, not recipient

    expect(response.status).toBe(404);
  });

  it('lists pending requests in the recipient inbox with sender info', async () => {
    await request(app)
      .post('/message-requests')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ recipientId: recipientId.toString(), introMessage: 'hello' });

    const inbox = await request(app).get('/message-requests/inbox').set('Authorization', `Bearer ${recipientToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.requests).toHaveLength(1);
    expect(inbox.body.requests[0].sender.id).toBe(senderId.toString());
    expect(inbox.body.requests[0].sender.username).toBeDefined();
  });
});
