import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

const mockUserId = new ObjectId();

// Mock auth middleware
vi.mock('@repo/utils', async () => {
  const actual = await vi.importActual('@repo/utils');
  return {
    ...actual,
    createAuthMiddleware: () => (req: any, _res: any, next: any) => {
      req.user = { userId: mockUserId.toString() };
      next();
    },
  };
});

describe('GET / - List Chats', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('should return empty array when user has no chats', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toEqual([]);
  });

  it('should return chats for authenticated user', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();

    // Create test chats
    await db.collection('chats').insertMany([
      {
        type: 'direct',
        participants: [mockUserId, otherUserId],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        type: 'group',
        participants: [mockUserId, otherUserId],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(2);
    expect(response.body.chats[0]._id).toBeDefined();
    expect(response.body.chats[0].type).toBeDefined();
    expect(response.body.chats[0].participants).toBeDefined();
    expect(response.body.chats[0].createdAt).toBeDefined();
    expect(response.body.chats[0].updatedAt).toBeDefined();
  });

  it('should sort chats by updatedAt descending', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Create test chats with different updatedAt times
    await db.collection('chats').insertMany([
      {
        type: 'direct',
        participants: [mockUserId, otherUserId],
        admins: [],
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
      },
      {
        type: 'direct',
        participants: [mockUserId, new ObjectId()],
        admins: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        type: 'direct',
        participants: [mockUserId, new ObjectId()],
        admins: [],
        createdAt: oneHourAgo,
        updatedAt: oneHourAgo,
      },
    ]);

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(3);

    // Verify sorting (most recent first)
    const timestamps = response.body.chats.map((chat: any) => new Date(chat.updatedAt).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
    expect(timestamps[1]).toBeGreaterThanOrEqual(timestamps[2]);
  });

  it('should include lastMessageRef if present', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();
    const messageId = new ObjectId();

    await db.collection('chats').insertOne({
      type: 'direct',
      participants: [mockUserId, otherUserId],
      admins: [],
      lastMessageRef: {
        messageId,
        body: 'Hello!',
        senderId: otherUserId,
        createdAt: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(1);
    expect(response.body.chats[0].lastMessageRef).toBeDefined();
    expect(response.body.chats[0].lastMessageRef.messageId).toBe(messageId.toString());
    expect(response.body.chats[0].lastMessageRef.body).toBe('Hello!');
    expect(response.body.chats[0].lastMessageRef.senderId).toBe(otherUserId.toString());
  });

  it('should not return chats where user is not a participant', async () => {
    const db = getDatabase();
    const user1 = new ObjectId();
    const user2 = new ObjectId();

    // Create chat without mockUserId
    await db.collection('chats').insertOne({
      type: 'direct',
      participants: [user1, user2],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toEqual([]);
  });

  it('should respect limit query parameter', async () => {
    const db = getDatabase();

    // Create 5 chats
    const chats = Array.from({ length: 5 }, (_, i) => ({
      type: 'direct' as const,
      participants: [mockUserId, new ObjectId()],
      admins: [],
      createdAt: new Date(Date.now() - i * 1000),
      updatedAt: new Date(Date.now() - i * 1000),
    }));

    await db.collection('chats').insertMany(chats);

    const response = await request(app).get('/?limit=3');

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(3);
  });

  it('should use default limit of 50 if not specified', async () => {
    const db = getDatabase();

    // Create 60 chats
    const chats = Array.from({ length: 60 }, (_, i) => ({
      type: 'direct' as const,
      participants: [mockUserId, new ObjectId()],
      admins: [],
      createdAt: new Date(Date.now() - i * 1000),
      updatedAt: new Date(Date.now() - i * 1000),
    }));

    await db.collection('chats').insertMany(chats);

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(50);
  });

  it('should include group chat title and avatarUrl', async () => {
    const db = getDatabase();

    await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, new ObjectId()],
      admins: [mockUserId],
      title: 'My Group',
      avatarUrl: 'https://example.com/avatar.jpg',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.chats).toHaveLength(1);
    expect(response.body.chats[0].title).toBe('My Group');
    expect(response.body.chats[0].avatarUrl).toBe('https://example.com/avatar.jpg');
  });
});
