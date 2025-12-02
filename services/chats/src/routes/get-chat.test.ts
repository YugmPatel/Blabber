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

describe('GET /:id - Get Chat', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('should return chat details for valid chat ID', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'direct',
      participants: [mockUserId, otherUserId],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).get(`/${chatId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.chat).toBeDefined();
    expect(response.body.chat._id).toBe(chatId.toString());
    expect(response.body.chat.type).toBe('direct');
    expect(response.body.chat.participants).toHaveLength(2);
    expect(response.body.chat.participants).toContain(mockUserId.toString());
    expect(response.body.chat.participants).toContain(otherUserId.toString());
    expect(response.body.chat.admins).toEqual([]);
    expect(response.body.chat.createdAt).toBeDefined();
    expect(response.body.chat.updatedAt).toBeDefined();
  });

  it('should return group chat with title, avatarUrl, and admins', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, otherUserId],
      admins: [mockUserId],
      title: 'Test Group',
      avatarUrl: 'https://example.com/avatar.jpg',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).get(`/${chatId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.chat.type).toBe('group');
    expect(response.body.chat.title).toBe('Test Group');
    expect(response.body.chat.avatarUrl).toBe('https://example.com/avatar.jpg');
    expect(response.body.chat.admins).toHaveLength(1);
    expect(response.body.chat.admins[0]).toBe(mockUserId.toString());
  });

  it('should include lastMessageRef if present', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();
    const messageId = new ObjectId();

    const result = await db.collection('chats').insertOne({
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

    const chatId = result.insertedId;

    const response = await request(app).get(`/${chatId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.chat.lastMessageRef).toBeDefined();
    expect(response.body.chat.lastMessageRef.messageId).toBe(messageId.toString());
    expect(response.body.chat.lastMessageRef.body).toBe('Hello!');
    expect(response.body.chat.lastMessageRef.senderId).toBe(otherUserId.toString());
    expect(response.body.chat.lastMessageRef.createdAt).toBeDefined();
  });

  it('should return 404 for non-existent chat', async () => {
    const nonExistentId = new ObjectId();

    const response = await request(app).get(`/${nonExistentId.toString()}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not Found');
    expect(response.body.message).toBe('Chat not found');
  });

  it('should return 400 for invalid chat ID', async () => {
    const response = await request(app).get('/invalid-id');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toBe('Invalid chat ID');
  });

  it('should return 403 if user is not a participant', async () => {
    const db = getDatabase();
    const user1 = new ObjectId();
    const user2 = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'direct',
      participants: [user1, user2],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).get(`/${chatId.toString()}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
    expect(response.body.message).toBe('You are not a participant in this chat');
  });

  it('should return all participants and admins for group chat', async () => {
    const db = getDatabase();
    const user2 = new ObjectId();
    const user3 = new ObjectId();
    const user4 = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, user2, user3, user4],
      admins: [mockUserId, user2],
      title: 'Large Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).get(`/${chatId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.chat.participants).toHaveLength(4);
    expect(response.body.chat.admins).toHaveLength(2);
    expect(response.body.chat.admins).toContain(mockUserId.toString());
    expect(response.body.chat.admins).toContain(user2.toString());
  });
});
