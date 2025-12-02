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

describe('Pin and Archive Functionality', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('userChatPreferences').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('POST /:id/pin - Pin Chat', () => {
    it('should pin a chat for authenticated user', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).post(`/${chatId.toString()}/pin`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Chat pinned successfully');

      // Verify preference was created
      const preference = await db
        .collection('userChatPreferences')
        .findOne({ userId: mockUserId, chatId });

      expect(preference).toBeDefined();
      expect(preference?.pinned).toBe(true);
      expect(preference?.archived).toBe(false);
    });

    it('should update existing preference when pinning', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      // Create existing preference
      await db.collection('userChatPreferences').insertOne({
        userId: mockUserId,
        chatId,
        pinned: false,
        archived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app).post(`/${chatId.toString()}/pin`);

      expect(response.status).toBe(200);

      // Verify preference was updated
      const preference = await db
        .collection('userChatPreferences')
        .findOne({ userId: mockUserId, chatId });

      expect(preference?.pinned).toBe(true);
    });

    it('should return 404 for non-existent chat', async () => {
      const nonExistentId = new ObjectId();

      const response = await request(app).post(`/${nonExistentId.toString()}/pin`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
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

      const response = await request(app).post(`/${chatId.toString()}/pin`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 400 for invalid chat ID', async () => {
      const response = await request(app).post('/invalid-id/pin');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('POST /:id/unpin - Unpin Chat', () => {
    it('should unpin a chat for authenticated user', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      // Create pinned preference
      await db.collection('userChatPreferences').insertOne({
        userId: mockUserId,
        chatId,
        pinned: true,
        archived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app).post(`/${chatId.toString()}/unpin`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify preference was updated
      const preference = await db
        .collection('userChatPreferences')
        .findOne({ userId: mockUserId, chatId });

      expect(preference?.pinned).toBe(false);
    });
  });

  describe('POST /:id/archive - Archive Chat', () => {
    it('should archive a chat for authenticated user', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).post(`/${chatId.toString()}/archive`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Chat archived successfully');

      // Verify preference was created
      const preference = await db
        .collection('userChatPreferences')
        .findOne({ userId: mockUserId, chatId });

      expect(preference).toBeDefined();
      expect(preference?.archived).toBe(true);
      expect(preference?.pinned).toBe(false);
    });

    it('should update existing preference when archiving', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      // Create existing preference
      await db.collection('userChatPreferences').insertOne({
        userId: mockUserId,
        chatId,
        pinned: true,
        archived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app).post(`/${chatId.toString()}/archive`);

      expect(response.status).toBe(200);

      // Verify preference was updated
      const preference = await db
        .collection('userChatPreferences')
        .findOne({ userId: mockUserId, chatId });

      expect(preference?.archived).toBe(true);
      expect(preference?.pinned).toBe(true); // Should preserve pinned status
    });

    it('should return 404 for non-existent chat', async () => {
      const nonExistentId = new ObjectId();

      const response = await request(app).post(`/${nonExistentId.toString()}/archive`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
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

      const response = await request(app).post(`/${chatId.toString()}/archive`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });
  });

  describe('POST /:id/unarchive - Unarchive Chat', () => {
    it('should unarchive a chat for authenticated user', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      // Create archived preference
      await db.collection('userChatPreferences').insertOne({
        userId: mockUserId,
        chatId,
        pinned: false,
        archived: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app).post(`/${chatId.toString()}/unarchive`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify preference was updated
      const preference = await db
        .collection('userChatPreferences')
        .findOne({ userId: mockUserId, chatId });

      expect(preference?.archived).toBe(false);
    });
  });
});
