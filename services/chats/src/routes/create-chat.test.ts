import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

// Mock auth middleware
vi.mock('@repo/utils', async () => {
  const actual = await vi.importActual('@repo/utils');
  return {
    ...actual,
    createAuthMiddleware: () => (req: any, _res: any, next: any) => {
      req.user = { userId: new ObjectId().toString() };
      next();
    },
  };
});

describe('POST / - Create Chat', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('Direct Chat Creation', () => {
    it('should create a direct chat with exactly 2 participants', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'direct',
          participantIds: [userId1, userId2],
        });

      expect(response.status).toBe(201);
      expect(response.body.chat).toBeDefined();
      expect(response.body.chat.type).toBe('direct');
      expect(response.body.chat.participants).toHaveLength(2);
      expect(response.body.chat.admins).toHaveLength(0);
      expect(response.body.chat.title).toBeUndefined();
      expect(response.body.chat.createdAt).toBeDefined();
      expect(response.body.chat.updatedAt).toBeDefined();
    });

    it('should reject direct chat with more than 2 participants', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();
      const userId3 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'direct',
          participantIds: [userId1, userId2, userId3],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject direct chat with less than 2 participants', async () => {
      const userId1 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'direct',
          participantIds: [userId1],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('Group Chat Creation', () => {
    it('should create a group chat with title and set creator as admin', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'group',
          participantIds: [userId1, userId2],
          title: 'Test Group',
        });

      expect(response.status).toBe(201);
      expect(response.body.chat).toBeDefined();
      expect(response.body.chat.type).toBe('group');
      expect(response.body.chat.title).toBe('Test Group');
      expect(response.body.chat.participants.length).toBeGreaterThanOrEqual(2);
      expect(response.body.chat.admins).toHaveLength(1);
      expect(response.body.chat.createdAt).toBeDefined();
      expect(response.body.chat.updatedAt).toBeDefined();
    });

    it('should create a group chat with avatarUrl', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'group',
          participantIds: [userId1, userId2],
          title: 'Test Group',
          avatarUrl: 'https://example.com/avatar.jpg',
        });

      expect(response.status).toBe(201);
      expect(response.body.chat.avatarUrl).toBe('https://example.com/avatar.jpg');
    });

    it('should reject group chat without title', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'group',
          participantIds: [userId1, userId2],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject group chat with empty title', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'group',
          participantIds: [userId1, userId2],
          title: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject group chat with title longer than 100 characters', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'group',
          participantIds: [userId1, userId2],
          title: 'a'.repeat(101),
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('Validation', () => {
    it('should reject invalid chat type', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'invalid',
          participantIds: [userId1, userId2],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject invalid avatarUrl', async () => {
      const userId1 = new ObjectId().toString();
      const userId2 = new ObjectId().toString();

      const response = await request(app)
        .post('/')
        .send({
          type: 'group',
          participantIds: [userId1, userId2],
          title: 'Test Group',
          avatarUrl: 'not-a-url',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject missing participantIds', async () => {
      const response = await request(app).post('/').send({
        type: 'direct',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject empty participantIds array', async () => {
      const response = await request(app).post('/').send({
        type: 'direct',
        participantIds: [],
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });
  });
});
