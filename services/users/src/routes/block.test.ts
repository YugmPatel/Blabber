import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { User } from '../models/user';

describe('Block/Unblock User', () => {
  let testUser1Id: ObjectId;
  let testUser2Id: ObjectId;
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
    await usersCollection.deleteMany({ username: /^test-block-/ });

    // Insert test users
    const testUsers: Partial<User>[] = [
      {
        username: 'test-block-user1',
        email: 'block-user1@example.com',
        passwordHash: 'hashed_password',
        name: 'Test User 1',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        username: 'test-block-user2',
        email: 'block-user2@example.com',
        passwordHash: 'hashed_password',
        name: 'Test User 2',
        contacts: [],
        blocked: [],
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await usersCollection.insertMany(testUsers as User[]);
    const insertedIds = Object.values(result.insertedIds);
    testUser1Id = insertedIds[0];
    testUser2Id = insertedIds[1];

    // Generate auth token for user1
    authToken = jwt.sign({ userId: testUser1Id.toString() }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: '15m',
    });
  });

  describe('POST /block', () => {
    it('should block a user successfully', async () => {
      const response = await request(app)
        .post('/block')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser2Id.toString() });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: 'User blocked successfully',
      });

      // Verify user was added to blocked list
      const db = getDatabase();
      const usersCollection = db.collection<User>('users');
      const user1 = await usersCollection.findOne({ _id: testUser1Id });

      expect(user1?.blocked).toContainEqual(testUser2Id);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).post('/block').send({ userId: testUser2Id.toString() });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid user ID format', async () => {
      const response = await request(app)
        .post('/block')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: 'invalid-id' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should return 400 when trying to block self', async () => {
      const response = await request(app)
        .post('/block')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser1Id.toString() });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Bad Request',
        message: 'Cannot block yourself',
      });
    });

    it('should return 404 for non-existent user', async () => {
      const nonExistentId = new ObjectId();
      const response = await request(app)
        .post('/block')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: nonExistentId.toString() });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: 'Not Found',
        message: 'User not found',
      });
    });

    it('should be idempotent (blocking already blocked user)', async () => {
      // Block user first time
      await request(app)
        .post('/block')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser2Id.toString() });

      // Block same user again
      const response = await request(app)
        .post('/block')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser2Id.toString() });

      expect(response.status).toBe(200);

      // Verify user appears only once in blocked list
      const db = getDatabase();
      const usersCollection = db.collection<User>('users');
      const user1 = await usersCollection.findOne({ _id: testUser1Id });

      const blockedCount = user1?.blocked.filter(
        (id) => id.toString() === testUser2Id.toString()
      ).length;
      expect(blockedCount).toBe(1);
    });
  });

  describe('POST /unblock', () => {
    beforeEach(async () => {
      // Block user2 before each unblock test
      const db = getDatabase();
      const usersCollection = db.collection<User>('users');
      await usersCollection.updateOne(
        { _id: testUser1Id },
        { $addToSet: { blocked: testUser2Id } }
      );
    });

    it('should unblock a user successfully', async () => {
      const response = await request(app)
        .post('/unblock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser2Id.toString() });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: 'User unblocked successfully',
      });

      // Verify user was removed from blocked list
      const db = getDatabase();
      const usersCollection = db.collection<User>('users');
      const user1 = await usersCollection.findOne({ _id: testUser1Id });

      expect(user1?.blocked).not.toContainEqual(testUser2Id);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).post('/unblock').send({ userId: testUser2Id.toString() });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid user ID format', async () => {
      const response = await request(app)
        .post('/unblock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: 'invalid-id' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should be idempotent (unblocking already unblocked user)', async () => {
      // Unblock user first time
      await request(app)
        .post('/unblock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser2Id.toString() });

      // Unblock same user again
      const response = await request(app)
        .post('/unblock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: testUser2Id.toString() });

      expect(response.status).toBe(200);
    });
  });
});
