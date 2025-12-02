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

describe('POST /:messageId/react - React to Message', () => {
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

  it('should add a reaction to a message', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Message to react to',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${insertResult.insertedId.toString()}/react`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        emoji: '👍',
      });

    expect(response.status).toBe(200);
    expect(response.body.reactions).toHaveLength(1);
    expect(response.body.reactions[0].emoji).toBe('👍');
    expect(response.body.reactions[0].userId).toBe(TEST_USER_ID.toString());

    // Verify reaction was added to database
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.reactions).toHaveLength(1);
    expect(message?.reactions[0].emoji).toBe('👍');
  });

  it('should update existing reaction for the same user', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Message with reaction',
      reactions: [
        {
          userId: TEST_USER_ID,
          emoji: '👍',
          createdAt: new Date(),
        },
      ],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${insertResult.insertedId.toString()}/react`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        emoji: '❤️',
      });

    expect(response.status).toBe(200);
    expect(response.body.reactions).toHaveLength(1);
    expect(response.body.reactions[0].emoji).toBe('❤️');
    expect(response.body.reactions[0].userId).toBe(TEST_USER_ID.toString());

    // Verify reaction was updated in database
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.reactions).toHaveLength(1);
    expect(message?.reactions[0].emoji).toBe('❤️');
  });

  it('should allow multiple users to react to the same message', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Popular message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    // First user reacts
    const token1 = generateToken(TEST_USER_ID.toString());
    const response1 = await request(app)
      .post(`/${insertResult.insertedId.toString()}/react`)
      .set('Authorization', `Bearer ${token1}`)
      .send({
        emoji: '👍',
      });

    expect(response1.status).toBe(200);
    expect(response1.body.reactions).toHaveLength(1);

    // Second user reacts
    const token2 = generateToken(OTHER_USER_ID.toString());
    const response2 = await request(app)
      .post(`/${insertResult.insertedId.toString()}/react`)
      .set('Authorization', `Bearer ${token2}`)
      .send({
        emoji: '❤️',
      });

    expect(response2.status).toBe(200);
    expect(response2.body.reactions).toHaveLength(2);

    // Verify both reactions in database
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.reactions).toHaveLength(2);
  });

  it('should return 404 for non-existent message', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const nonExistentId = new ObjectId();

    const response = await request(app)
      .post(`/${nonExistentId.toString()}/react`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        emoji: '👍',
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Message not found');
  });

  it('should return 400 for invalid message ID', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/invalid-id/react')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emoji: '👍',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid message ID');
  });

  it('should return 400 for invalid emoji', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${insertResult.insertedId.toString()}/react`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        emoji: '',
      });

    expect(response.status).toBe(400);
  });

  it('should return 401 if not authenticated', async () => {
    const messageId = new ObjectId();

    const response = await request(app).post(`/${messageId.toString()}/react`).send({
      emoji: '👍',
    });

    expect(response.status).toBe(401);
  });
});
