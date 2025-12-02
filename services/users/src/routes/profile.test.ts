import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { User } from '../models/user';

describe('GET /:id - User Profile Retrieval', () => {
  let testUserId: ObjectId;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    const db = getDatabase();
    const usersCollection = db.collection<User>('users');

    // Clean up test data
    await usersCollection.deleteMany({ username: /^test-profile-/ });

    // Insert test user
    const testUser: Partial<User> = {
      username: 'test-profile-user',
      email: 'test-profile@example.com',
      passwordHash: 'hashed_password',
      name: 'Test Profile User',
      avatarUrl: 'https://example.com/avatar.jpg',
      about: 'Test user bio',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(testUser as User);
    testUserId = result.insertedId;
  });

  it('should return user profile by ID', async () => {
    const response = await request(app).get(`/${testUserId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      _id: testUserId.toString(),
      username: 'test-profile-user',
      name: 'Test Profile User',
      avatarUrl: 'https://example.com/avatar.jpg',
      about: 'Test user bio',
    });
    expect(response.body.user.lastSeen).toBeDefined();
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.email).toBeUndefined();
  });

  it('should return 404 for non-existent user', async () => {
    const nonExistentId = new ObjectId();
    const response = await request(app).get(`/${nonExistentId.toString()}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: 'Not Found',
      message: 'User not found',
    });
  });

  it('should return 400 for invalid user ID format', async () => {
    const response = await request(app).get('/invalid-id-format');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Invalid user ID format',
    });
  });

  it('should not expose sensitive information', async () => {
    const response = await request(app).get(`/${testUserId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.email).toBeUndefined();
    expect(response.body.user.contacts).toBeUndefined();
    expect(response.body.user.blocked).toBeUndefined();
  });
});
