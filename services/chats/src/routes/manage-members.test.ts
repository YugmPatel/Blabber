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

describe('Group Member Management', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('POST /:id/members - Add Member', () => {
    it('should add a member to group chat as admin', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();
      const newUser = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, user2],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app)
        .post(`/${chatId.toString()}/members`)
        .send({ userId: newUser.toString() });

      expect(response.status).toBe(200);
      expect(response.body.chat.participants).toHaveLength(3);
      expect(response.body.chat.participants).toContain(newUser.toString());
    });

    it('should reject adding member if user is not admin', async () => {
      const db = getDatabase();
      const admin = new ObjectId();
      const newUser = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, admin],
        admins: [admin], // mockUserId is not admin
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app)
        .post(`/${chatId.toString()}/members`)
        .send({ userId: newUser.toString() });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Only group admins can perform this action');
    });

    it('should reject adding member to direct chat', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();
      const newUser = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'direct',
        participants: [mockUserId, user2],
        admins: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app)
        .post(`/${chatId.toString()}/members`)
        .send({ userId: newUser.toString() });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('This operation is only available for group chats');
    });

    it('should reject adding member who is already a participant', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, user2],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app)
        .post(`/${chatId.toString()}/members`)
        .send({ userId: user2.toString() });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('User is already a member of this chat');
    });

    it('should reject invalid userId', async () => {
      const db = getDatabase();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app)
        .post(`/${chatId.toString()}/members`)
        .send({ userId: 'invalid-id' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should return 404 for non-existent chat', async () => {
      const nonExistentId = new ObjectId();
      const newUser = new ObjectId();

      const response = await request(app)
        .post(`/${nonExistentId.toString()}/members`)
        .send({ userId: newUser.toString() });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });
  });

  describe('DELETE /:id/members/:userId - Remove Member', () => {
    it('should remove a member from group chat as admin', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();
      const user3 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, user2, user3],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).delete(
        `/${chatId.toString()}/members/${user3.toString()}`
      );

      expect(response.status).toBe(200);
      expect(response.body.chat.participants).toHaveLength(2);
      expect(response.body.chat.participants).not.toContain(user3.toString());
    });

    it('should remove admin privileges when removing an admin member', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();
      const user3 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, user2, user3],
        admins: [mockUserId, user2],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).delete(
        `/${chatId.toString()}/members/${user2.toString()}`
      );

      expect(response.status).toBe(200);
      expect(response.body.chat.participants).not.toContain(user2.toString());
      expect(response.body.chat.admins).not.toContain(user2.toString());
      expect(response.body.chat.admins).toHaveLength(1);
    });

    it('should reject removing the last admin', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, user2],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).delete(
        `/${chatId.toString()}/members/${mockUserId.toString()}`
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('Cannot remove the last admin from the group');
    });

    it('should reject removing member if user is not admin', async () => {
      const db = getDatabase();
      const admin = new ObjectId();
      const user3 = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, admin, user3],
        admins: [admin], // mockUserId is not admin
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).delete(
        `/${chatId.toString()}/members/${user3.toString()}`
      );

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });

    it('should reject removing member from direct chat', async () => {
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

      const response = await request(app).delete(
        `/${chatId.toString()}/members/${user2.toString()}`
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('should reject removing non-participant', async () => {
      const db = getDatabase();
      const user2 = new ObjectId();
      const nonParticipant = new ObjectId();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, user2],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).delete(
        `/${chatId.toString()}/members/${nonParticipant.toString()}`
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('User is not a member of this chat');
    });

    it('should reject invalid userId', async () => {
      const db = getDatabase();

      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const chatId = result.insertedId;

      const response = await request(app).delete(`/${chatId.toString()}/members/invalid-id`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });
  });
});
