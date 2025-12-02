import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getMessagesCollection } from '../models/message';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;
const TEST_USER_ID = new ObjectId();
const TEST_CHAT_ID = new ObjectId();
const OTHER_USER_ID = new ObjectId();

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

describe('POST /read - Mark Messages as Read', () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('messages').deleteMany({});
  });

  it('should mark a single message as read', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Unread message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/read')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: [insertResult.insertedId.toString()],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.modifiedCount).toBe(1);

    // Verify message status was updated
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.status).toBe('read');
  });

  it('should mark multiple messages as read in batch', async () => {
    const collection = getMessagesCollection();

    const message1 = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Message 1',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const message2 = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Message 2',
      reactions: [],
      status: 'delivered' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const message3 = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Message 3',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/read')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: [
          message1.insertedId.toString(),
          message2.insertedId.toString(),
          message3.insertedId.toString(),
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.modifiedCount).toBe(3);

    // Verify all messages were updated
    const messages = await collection
      .find({
        _id: {
          $in: [message1.insertedId, message2.insertedId, message3.insertedId],
        },
      })
      .toArray();

    expect(messages.every((m) => m.status === 'read')).toBe(true);
  });

  it('should not update messages that are already read', async () => {
    const collection = getMessagesCollection();

    const message1 = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Already read',
      reactions: [],
      status: 'read' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const message2 = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Unread',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/read')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: [message1.insertedId.toString(), message2.insertedId.toString()],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.modifiedCount).toBe(1); // Only one message was updated
  });

  it('should return 400 for empty messageIds array', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app).post('/read').set('Authorization', `Bearer ${token}`).send({
      messageIds: [],
    });

    expect(response.status).toBe(400);
  });

  it('should return 400 for invalid message IDs', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/read')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: ['invalid-id', 'another-invalid'],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid message IDs');
    expect(response.body.invalidIds).toHaveLength(2);
  });

  it('should return 400 for missing messageIds', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/read')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('should return 401 if not authenticated', async () => {
    const response = await request(app)
      .post('/read')
      .send({
        messageIds: [new ObjectId().toString()],
      });

    expect(response.status).toBe(401);
  });

  it('should handle non-existent message IDs gracefully', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const nonExistentId1 = new ObjectId();
    const nonExistentId2 = new ObjectId();

    const response = await request(app)
      .post('/read')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: [nonExistentId1.toString(), nonExistentId2.toString()],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.modifiedCount).toBe(0);
  });
});
