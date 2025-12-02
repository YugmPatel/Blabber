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

describe('PATCH /:messageId - Edit Message', () => {
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

  it('should edit a message successfully', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Original message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .patch(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Edited message',
      });

    expect(response.status).toBe(200);
    expect(response.body.body).toBe('Edited message');
    expect(response.body.editedAt).toBeDefined();

    // Verify message was updated in database
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.body).toBe('Edited message');
    expect(message?.editedAt).toBeDefined();
  });

  it('should return 403 if user is not the sender', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Someone elses message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .patch(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Trying to edit',
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('You can only edit your own messages');
  });

  it('should return 404 for non-existent message', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const nonExistentId = new ObjectId();

    const response = await request(app)
      .patch(`/${nonExistentId.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Edited message',
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Message not found');
  });

  it('should return 400 for invalid message ID', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .patch('/invalid-id')
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Edited message',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid message ID');
  });

  it('should return 400 for empty body', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Original message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .patch(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: '',
      });

    expect(response.status).toBe(400);
  });

  it('should return 401 if not authenticated', async () => {
    const messageId = new ObjectId();

    const response = await request(app).patch(`/${messageId.toString()}`).send({
      body: 'Edited message',
    });

    expect(response.status).toBe(401);
  });

  it('should preserve other message fields when editing', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Original message',
      media: {
        type: 'image' as const,
        url: 'https://example.com/image.jpg',
      },
      reactions: [
        {
          userId: OTHER_USER_ID,
          emoji: '👍',
          createdAt: new Date(),
        },
      ],
      status: 'read' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .patch(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Edited message',
      });

    expect(response.status).toBe(200);
    expect(response.body.body).toBe('Edited message');
    expect(response.body.media).toBeDefined();
    expect(response.body.reactions).toHaveLength(1);
    expect(response.body.status).toBe('read');
  });
});
