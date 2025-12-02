import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId, Db } from 'mongodb';
import bcrypt from 'bcrypt';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getUsersCollection } from '../models/user';
import { generateAccessToken } from '../utils/jwt';

let testDb: Db;

describe('GET /me', () => {
  beforeAll(async () => {
    await connectToDatabase();
    testDb = getDatabase();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.dropDatabase();
    }
    await closeDatabase();
  });

  beforeEach(async () => {
    if (testDb) {
      await testDb.collection('users').deleteMany({});
      await testDb.collection('deviceSessions').deleteMany({});
    }
  });

  it('should return authenticated user details', async () => {
    // Create a test user
    const usersCollection = getUsersCollection();
    const userId = new ObjectId();
    const passwordHash = await bcrypt.hash('password123', 10);
    const now = new Date();

    await usersCollection.insertOne({
      _id: userId,
      username: 'testuser',
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      avatarUrl: 'https://example.com/avatar.jpg',
      about: 'Test about',
      contacts: [],
      blocked: [],
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
    });

    // Generate access token
    const accessToken = generateAccessToken({
      userId: userId.toString(),
      username: 'testuser',
      email: 'test@example.com',
    });

    // Make request with auth token
    const response = await request(app).get('/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toMatchObject({
      _id: userId.toString(),
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: 'https://example.com/avatar.jpg',
      about: 'Test about',
    });
    expect(response.body.user).toHaveProperty('lastSeen');
    expect(response.body.user).toHaveProperty('createdAt');
  });

  it('should return 401 when no authorization header is provided', async () => {
    const response = await request(app).get('/me');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('authorization');
  });

  it('should return 401 when invalid token is provided', async () => {
    const response = await request(app).get('/me').set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  it('should return 401 when authorization header format is invalid', async () => {
    const response = await request(app).get('/me').set('Authorization', 'InvalidFormat token');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  it('should return 404 when user does not exist in database', async () => {
    // Generate token for non-existent user
    const nonExistentUserId = new ObjectId();
    const accessToken = generateAccessToken({
      userId: nonExistentUserId.toString(),
      username: 'nonexistent',
      email: 'nonexistent@example.com',
    });

    const response = await request(app).get('/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.body.message).toContain('not found');
  });

  it('should return user details without optional fields when not set', async () => {
    // Create a test user without optional fields
    const usersCollection = getUsersCollection();
    const userId = new ObjectId();
    const passwordHash = await bcrypt.hash('password123', 10);
    const now = new Date();

    await usersCollection.insertOne({
      _id: userId,
      username: 'minimaluser',
      email: 'minimal@example.com',
      passwordHash,
      name: 'Minimal User',
      contacts: [],
      blocked: [],
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
    });

    // Generate access token
    const accessToken = generateAccessToken({
      userId: userId.toString(),
      username: 'minimaluser',
      email: 'minimal@example.com',
    });

    // Make request with auth token
    const response = await request(app).get('/me').set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      _id: userId.toString(),
      username: 'minimaluser',
      email: 'minimal@example.com',
      name: 'Minimal User',
    });
    expect(response.body.user.avatarUrl).toBeUndefined();
    expect(response.body.user.about).toBeUndefined();
  });
});
