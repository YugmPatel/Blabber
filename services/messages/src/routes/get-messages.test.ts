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

describe('GET /:chatId - Get Messages', () => {
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

  it('should retrieve messages for a chat with pagination', async () => {
    const collection = getMessagesCollection();

    // Insert test messages
    const messages = [];
    for (let i = 0; i < 5; i++) {
      messages.push({
        _id: new ObjectId(),
        chatId: TEST_CHAT_ID,
        senderId: TEST_USER_ID,
        body: `Message ${i}`,
        reactions: [],
        status: 'sent' as const,
        deletedFor: [],
        createdAt: new Date(Date.now() - i * 1000), // Descending order
      });
    }
    await collection.insertMany(messages);

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .get(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: '3' });

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(3);
    expect(response.body.nextCursor).toBeDefined();
    expect(response.body.messages[0].body).toBe('Message 0');
  });

  it('should use cursor for pagination', async () => {
    const collection = getMessagesCollection();

    // Insert test messages
    const messages = [];
    for (let i = 0; i < 5; i++) {
      messages.push({
        _id: new ObjectId(),
        chatId: TEST_CHAT_ID,
        senderId: TEST_USER_ID,
        body: `Message ${i}`,
        reactions: [],
        status: 'sent' as const,
        deletedFor: [],
        createdAt: new Date(Date.now() - i * 1000),
      });
    }
    await collection.insertMany(messages);

    const token = generateToken(TEST_USER_ID.toString());

    // First request
    const firstResponse = await request(app)
      .get(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: '2' });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.messages).toHaveLength(2);
    expect(firstResponse.body.nextCursor).toBeDefined();

    // Second request with cursor
    const secondResponse = await request(app)
      .get(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: '2', cursor: firstResponse.body.nextCursor });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.messages).toHaveLength(2);
    expect(secondResponse.body.messages[0]._id).not.toBe(firstResponse.body.messages[0]._id);
  });

  it('should exclude messages deleted by the user', async () => {
    const collection = getMessagesCollection();

    await collection.insertMany([
      {
        _id: new ObjectId(),
        chatId: TEST_CHAT_ID,
        senderId: TEST_USER_ID,
        body: 'Visible message',
        reactions: [],
        status: 'sent' as const,
        deletedFor: [],
        createdAt: new Date(),
      },
      {
        _id: new ObjectId(),
        chatId: TEST_CHAT_ID,
        senderId: OTHER_USER_ID,
        body: 'Deleted message',
        reactions: [],
        status: 'sent' as const,
        deletedFor: [TEST_USER_ID],
        createdAt: new Date(Date.now() - 1000),
      },
    ]);

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .get(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.messages[0].body).toBe('Visible message');
  });

  it('should return 401 if not authenticated', async () => {
    const response = await request(app).get(`/${TEST_CHAT_ID.toString()}`);

    expect(response.status).toBe(401);
  });

  it('should return 400 for invalid chat ID', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app).get('/invalid-id').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid chat ID');
  });

  it('should return empty array when no messages exist', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .get(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(0);
    expect(response.body.nextCursor).toBeNull();
  });

  it('should handle messages with media and replies', async () => {
    const collection = getMessagesCollection();

    await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Message with media',
      media: {
        type: 'image',
        url: 'https://example.com/image.jpg',
        thumbnailUrl: 'https://example.com/thumb.jpg',
      },
      replyTo: {
        messageId: new ObjectId(),
        body: 'Original message',
        senderId: OTHER_USER_ID,
      },
      reactions: [
        {
          userId: OTHER_USER_ID,
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
      .get(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.messages[0].media).toBeDefined();
    expect(response.body.messages[0].media.type).toBe('image');
    expect(response.body.messages[0].replyTo).toBeDefined();
    expect(response.body.messages[0].reactions).toHaveLength(1);
  });
});
