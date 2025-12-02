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

describe('DELETE /:messageId - Delete Message', () => {
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

  it('should soft delete a message successfully', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Message to delete',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .delete(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verify message was soft deleted
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.deletedFor).toHaveLength(1);
    expect(message?.deletedFor[0].toString()).toBe(TEST_USER_ID.toString());
  });

  it('should allow multiple users to delete the same message', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Message to delete',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    // First user deletes
    const token1 = generateToken(TEST_USER_ID.toString());
    const response1 = await request(app)
      .delete(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token1}`);

    expect(response1.status).toBe(200);

    // Second user deletes
    const token2 = generateToken(OTHER_USER_ID.toString());
    const response2 = await request(app)
      .delete(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(response2.status).toBe(200);

    // Verify both users are in deletedFor array
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message?.deletedFor).toHaveLength(2);
  });

  it('should return success if message already deleted for user', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Already deleted message',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [TEST_USER_ID],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .delete(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('already deleted');
  });

  it('should return 404 for non-existent message', async () => {
    const token = generateToken(TEST_USER_ID.toString());
    const nonExistentId = new ObjectId();

    const response = await request(app)
      .delete(`/${nonExistentId.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Message not found');
  });

  it('should return 400 for invalid message ID', async () => {
    const token = generateToken(TEST_USER_ID.toString());

    const response = await request(app)
      .delete('/invalid-id')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid message ID');
  });

  it('should return 401 if not authenticated', async () => {
    const messageId = new ObjectId();

    const response = await request(app).delete(`/${messageId.toString()}`);

    expect(response.status).toBe(401);
  });

  it('should not actually remove the message from database', async () => {
    const collection = getMessagesCollection();

    const insertResult = await collection.insertOne({
      _id: new ObjectId(),
      chatId: TEST_CHAT_ID,
      senderId: TEST_USER_ID,
      body: 'Message to soft delete',
      reactions: [],
      status: 'sent' as const,
      deletedFor: [],
      createdAt: new Date(),
    });

    const token = generateToken(TEST_USER_ID.toString());

    await request(app)
      .delete(`/${insertResult.insertedId.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    // Message should still exist in database
    const message = await collection.findOne({ _id: insertResult.insertedId });
    expect(message).toBeDefined();
    expect(message?.body).toBe('Message to soft delete');
  });
});
