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

describe('PATCH /:id - Update Chat', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('should update chat title as admin', async () => {
    const db = getDatabase();
    const user2 = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, user2],
      admins: [mockUserId],
      title: 'Old Title',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).patch(`/${chatId.toString()}`).send({ title: 'New Title' });

    expect(response.status).toBe(200);
    expect(response.body.chat.title).toBe('New Title');
  });

  it('should update chat avatarUrl as admin', async () => {
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
      .patch(`/${chatId.toString()}`)
      .send({ avatarUrl: 'https://example.com/new-avatar.jpg' });

    expect(response.status).toBe(200);
    expect(response.body.chat.avatarUrl).toBe('https://example.com/new-avatar.jpg');
  });

  it('should update both title and avatarUrl', async () => {
    const db = getDatabase();
    const user2 = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, user2],
      admins: [mockUserId],
      title: 'Old Title',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).patch(`/${chatId.toString()}`).send({
      title: 'New Title',
      avatarUrl: 'https://example.com/avatar.jpg',
    });

    expect(response.status).toBe(200);
    expect(response.body.chat.title).toBe('New Title');
    expect(response.body.chat.avatarUrl).toBe('https://example.com/avatar.jpg');
  });

  it('should update updatedAt timestamp', async () => {
    const db = getDatabase();
    const user2 = new ObjectId();
    const oldDate = new Date(Date.now() - 60000); // 1 minute ago

    const result = await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, user2],
      admins: [mockUserId],
      title: 'Test Group',
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    const chatId = result.insertedId;

    const response = await request(app)
      .patch(`/${chatId.toString()}`)
      .send({ title: 'Updated Title' });

    expect(response.status).toBe(200);
    const updatedAt = new Date(response.body.chat.updatedAt);
    expect(updatedAt.getTime()).toBeGreaterThan(oldDate.getTime());
  });

  it('should reject update if user is not admin', async () => {
    const db = getDatabase();
    const admin = new ObjectId();

    const result = await db.collection('chats').insertOne({
      type: 'group',
      participants: [mockUserId, admin],
      admins: [admin], // mockUserId is not admin
      title: 'Test Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = result.insertedId;

    const response = await request(app).patch(`/${chatId.toString()}`).send({ title: 'New Title' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
    expect(response.body.message).toBe('Only group admins can perform this action');
  });

  it('should reject update for direct chat', async () => {
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

    const response = await request(app).patch(`/${chatId.toString()}`).send({ title: 'New Title' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Bad Request');
    expect(response.body.message).toBe('This operation is only available for group chats');
  });

  it('should reject empty request body', async () => {
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

    const response = await request(app).patch(`/${chatId.toString()}`).send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toBe('At least one field (title or avatarUrl) must be provided');
  });

  it('should reject invalid avatarUrl', async () => {
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
      .patch(`/${chatId.toString()}`)
      .send({ avatarUrl: 'not-a-url' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should reject title longer than 100 characters', async () => {
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
      .patch(`/${chatId.toString()}`)
      .send({ title: 'a'.repeat(101) });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should reject empty title', async () => {
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

    const response = await request(app).patch(`/${chatId.toString()}`).send({ title: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 404 for non-existent chat', async () => {
    const nonExistentId = new ObjectId();

    const response = await request(app)
      .patch(`/${nonExistentId.toString()}`)
      .send({ title: 'New Title' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not Found');
  });
});
