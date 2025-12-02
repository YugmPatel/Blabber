import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { User } from '../models/user';

describe('PATCH /me - Update Profile', () => {
  let testUserId: ObjectId;
  let authToken: string;

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
    await usersCollection.deleteMany({ username: /^test-update-/ });

    // Insert test user
    const testUser: Partial<User> = {
      username: 'test-update-user',
      email: 'test-update@example.com',
      passwordHash: 'hashed_password',
      name: 'Original Name',
      avatarUrl: 'https://example.com/original.jpg',
      about: 'Original bio',
      contacts: [],
      blocked: [],
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(testUser as User);
    testUserId = result.insertedId;

    // Generate auth token
    authToken = jwt.sign({ userId: testUserId.toString() }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });
  });

  it('should update user name', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Updated Name');
    expect(response.body.user._id).toBe(testUserId.toString());
  });

  it('should update user avatarUrl', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ avatarUrl: 'https://example.com/new-avatar.jpg' });

    expect(response.status).toBe(200);
    expect(response.body.user.avatarUrl).toBe('https://example.com/new-avatar.jpg');
  });

  it('should update user about', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ about: 'Updated bio text' });

    expect(response.status).toBe(200);
    expect(response.body.user.about).toBe('Updated bio text');
  });

  it('should update multiple fields at once', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'New Name',
        avatarUrl: 'https://example.com/new.jpg',
        about: 'New bio',
      });

    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('New Name');
    expect(response.body.user.avatarUrl).toBe('https://example.com/new.jpg');
    expect(response.body.user.about).toBe('New bio');
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app).patch('/me').send({ name: 'Updated Name' });

    expect(response.status).toBe(401);
  });

  it('should return 400 for invalid name (empty string)', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for invalid avatarUrl', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ avatarUrl: 'not-a-valid-url' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for about text exceeding max length', async () => {
    const longAbout = 'a'.repeat(501);
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ about: longAbout });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should allow clearing avatarUrl with empty string', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ avatarUrl: '' });

    expect(response.status).toBe(200);
    expect(response.body.user.avatarUrl).toBeUndefined();
  });

  it('should allow clearing about with empty string', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ about: '' });

    expect(response.status).toBe(200);
    expect(response.body.user.about).toBeUndefined();
  });

  it('should not expose sensitive information', async () => {
    const response = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(200);
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.email).toBeUndefined();
    expect(response.body.user.contacts).toBeUndefined();
    expect(response.body.user.blocked).toBeUndefined();
  });
});
