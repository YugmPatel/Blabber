import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { ObjectId, Db } from 'mongodb';
import { randomBytes } from 'crypto';
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

describe('POST /password/reset', () => {
  beforeEach(async () => {
    // Clear collections
    await getUsersCollection().deleteMany({});
    await getPasswordResetTokensCollection().deleteMany({});
  });

  it('should reset password with valid token', async () => {
    // Create test user
    const usersCollection = getUsersCollection();
    const oldPasswordHash = await bcrypt.hash('oldpassword123', 10);
    const userId = new ObjectId();

    await usersCollection.insertOne({
      _id: userId,
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: oldPasswordHash,
      name: 'Test User',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create reset token
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await getPasswordResetTokensCollection().insertOne({
      _id: new ObjectId(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      used: false,
    });

    // Reset password
    const response = await request(app).post('/password/reset').send({
      token: resetToken,
      newPassword: 'newpassword123',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('Password has been reset successfully');

    // Verify password was updated
    const updatedUser = await usersCollection.findOne({ _id: userId });
    expect(updatedUser).toBeDefined();
    const isNewPasswordValid = await bcrypt.compare('newpassword123', updatedUser!.passwordHash);
    expect(isNewPasswordValid).toBe(true);

    // Verify old password no longer works
    const isOldPasswordValid = await bcrypt.compare('oldpassword123', updatedUser!.passwordHash);
    expect(isOldPasswordValid).toBe(false);

    // Verify token was marked as used
    const token = await getPasswordResetTokensCollection().findOne({ userId });
    expect(token?.used).toBe(true);
  });

  it('should reject invalid token', async () => {
    const response = await request(app).post('/password/reset').send({
      token: 'invalid-token',
      newPassword: 'newpassword123',
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid or expired reset token');
  });

  it('should reject expired token', async () => {
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

    // Create expired reset token
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago

    await getPasswordResetTokensCollection().insertOne({
      _id: new ObjectId(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      used: false,
    });

    // Try to reset password
    const response = await request(app).post('/password/reset').send({
      token: resetToken,
      newPassword: 'newpassword123',
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid or expired reset token');
  });

  it('should reject already used token', async () => {
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

    // Create reset token
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await getPasswordResetTokensCollection().insertOne({
      _id: new ObjectId(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      used: true, // Already used
    });

    // Try to reset password
    const response = await request(app).post('/password/reset').send({
      token: resetToken,
      newPassword: 'newpassword123',
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid or expired reset token');
  });

  it('should reject password shorter than 8 characters', async () => {
    const response = await request(app).post('/password/reset').send({
      token: 'some-token',
      newPassword: 'short',
    });

    expect(response.status).toBe(400);
  });

  it('should reject missing token', async () => {
    const response = await request(app).post('/password/reset').send({
      newPassword: 'newpassword123',
    });

    expect(response.status).toBe(400);
  });

  it('should reject missing password', async () => {
    const response = await request(app).post('/password/reset').send({
      token: 'some-token',
    });

    expect(response.status).toBe(400);
  });

  it('should not allow token reuse after successful reset', async () => {
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

    // Create reset token
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await getPasswordResetTokensCollection().insertOne({
      _id: new ObjectId(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      used: false,
    });

    // First reset - should succeed
    const firstResponse = await request(app).post('/password/reset').send({
      token: resetToken,
      newPassword: 'newpassword123',
    });

    expect(firstResponse.status).toBe(200);

    // Second reset with same token - should fail
    const secondResponse = await request(app).post('/password/reset').send({
      token: resetToken,
      newPassword: 'anotherpassword123',
    });

    expect(secondResponse.status).toBe(401);
    expect(secondResponse.body.message).toContain('Invalid or expired reset token');
  });
});
