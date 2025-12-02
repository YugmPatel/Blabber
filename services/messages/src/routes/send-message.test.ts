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

describe('POST /:chatId - Send Message', () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.collection('messages').deleteMany({});
    await db.collection('chats').deleteMany({});

    // Create test chat
    await db.collection('chats').insertOne({
      _id: TEST_CHAT_ID,
      type: 'direct',
      participants: [TEST_USER_ID, OTHER_USER_ID],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('should send a message successfully', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Hello, world!',
      });

    expect(response.status).toBe(201);
    expect(response.body._id).toBeDefined();
    expect(response.body.chatId).toBe(TEST_CHAT_ID.toString());
    expect(response.body.senderId).toBe(TEST_USER_ID.toString());
    expect(response.body.body).toBe('Hello, world!');
    expect(response.body.status).toBe('sent');
    expect(response.body.reactions).toEqual([]);

    // Verify message was inserted
    const collection = getMessagesCollection();
    const messageId = new ObjectId(response.body._id);
    const message = await collection.findOne({ _id: messageId });
    expect(message).toBeDefined();
    expect(message?.body).toBe('Hello, world!');
  });

  it('should update chat lastMessageRef', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Test message',
      });

    expect(response.status).toBe(201);

    // Verify chat was updated
    const db = getDatabase();
    const chat = await db.collection('chats').findOne({ _id: TEST_CHAT_ID });
    expect(chat?.lastMessageRef).toBeDefined();
    expect(chat?.lastMessageRef.body).toBe('Test message');
    expect(chat?.lastMessageRef.messageId.toString()).toBe(response.body._id);
  });

  it('should send message with tempId for optimistic updates', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const tempId = 'temp-123-456';

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Optimistic message',
        tempId,
      });

    expect(response.status).toBe(201);
    expect(response.body.tempId).toBe(tempId);
  });

  it('should send message with media', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Check out this image',
        mediaId: 'media-123',
      });

    expect(response.status).toBe(201);
    expect(response.body.media).toBeDefined();
    expect(response.body.media.type).toBe('image');
  });

  it('should send message with reply', async () => {
    const collection = getMessagesCollection();

    // Create original message
    const originalMessage = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: OTHER_USER_ID,
      body: 'Original message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Reply to original',
        replyToId: originalMessage.insertedId.toString(),
      });

    expect(response.status).toBe(201);
    expect(response.body.replyTo).toBeDefined();
    expect(response.body.replyTo.messageId).toBe(originalMessage.insertedId.toString());
    expect(response.body.replyTo.body).toBe('Original message');
  });

  it('should return 400 for invalid chat ID', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post('/invalid-id')
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Test message',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid chat ID');
  });

  it('should return 400 for empty body', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: '',
      });

    expect(response.status).toBe(400);
  });

  it('should return 404 for invalid replyToId', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const nonExistentId = new ObjectId();

    const response = await request(app)
      .post(`/${TEST_CHAT_ID.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Reply to non-existent',
        replyToId: nonExistentId.toString(),
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Reply message not found');
  });

  it('should return 401 if not authenticated', async () => {
    const response = await request(app).post(`/${TEST_CHAT_ID.toString()}`).send({
      body: 'Test message',
    });

    expect(response.status).toBe(401);
  });
});
