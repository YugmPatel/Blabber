import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { ObjectId, Db } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getUsersCollection } from '../models/user';
import { getPasswordResetTokensCollection } from '../models/password-reset-token';

let testDb: Db;

beforeAll(async () => {
  // Connect to test database
  await connectToDatabase();
  testDb = getDatabase();
});

afterAll(async () => {
  // Clean up and close connection
  if (testDb) {
    await testDb.dropDatabase();
  }
  await closeDatabase();
});

describe('POST /password/forgot', () => {
  beforeEach(async () => {
    // Clear collections
    await getUsersCollection().deleteMany({});
    await getPasswordResetTokensCollection().deleteMany({});
  });

  it('should return success even if email does not exist (prevent enumeration)', async () => {
    const response = await request(app).post('/password/forgot').send({
      email: 'nonexistent@example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('If an account with that email exists');

    // Verify no token was created
    const tokens = await getPasswordResetTokensCollection().find({}).toArray();
    expect(tokens).toHaveLength(0);
  });

  it('should create reset token for existing user', async () => {
    // Create test user
    const usersCollection = getUsersCollection();
    const passwordHash = await bcrypt.hash('password123', 10);
    const userId = new ObjectId();

    await usersCollection.insertOne({
      _id: userId,
      username: 'testuser',
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).post('/password/forgot').send({
      email: 'test@example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('If an account with that email exists');

    // Verify token was created
    const tokens = await getPasswordResetTokensCollection().find({ userId }).toArray();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].userId.toString()).toBe(userId.toString());
    expect(tokens[0].used).toBe(false);
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should invalidate existing reset tokens when creating new one', async () => {
    // Create test user
    const usersCollection = getUsersCollection();
    const passwordHash = await bcrypt.hash('password123', 10);
    const userId = new ObjectId();

    await usersCollection.insertOne({
      _id: userId,
      username: 'testuser',
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create first reset token
    await request(app).post('/password/forgot').send({
      email: 'test@example.com',
    });

    // Create second reset token
    await request(app).post('/password/forgot').send({
      email: 'test@example.com',
    });

    // Verify only one token exists
    const tokens = await getPasswordResetTokensCollection().find({ userId }).toArray();
    expect(tokens).toHaveLength(1);
  });

  it('should return reset token in development mode', async () => {
    // Create test user
    const usersCollection = getUsersCollection();
    const passwordHash = await bcrypt.hash('password123', 10);
    const userId = new ObjectId();

    await usersCollection.insertOne({
      _id: userId,
      username: 'testuser',
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Set NODE_ENV to development
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const response = await request(app).post('/password/forgot').send({
      email: 'test@example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.resetToken).toBeDefined();
    expect(typeof response.body.resetToken).toBe('string');

    // Restore NODE_ENV
    process.env.NODE_ENV = originalEnv;
  });

  it('should reject invalid email format', async () => {
    const response = await request(app).post('/password/forgot').send({
      email: 'invalid-email',
    });

    expect(response.status).toBe(400);
  });

  it('should reject missing email', async () => {
    const response = await request(app).post('/password/forgot').send({});

    expect(response.status).toBe(400);
  });
});
