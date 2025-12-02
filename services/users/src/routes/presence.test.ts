import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { connectToRedis, closeRedis, getRedisClient } from '../redis';
import { User } from '../models/user';
import { updatePresence } from './presence';

describe('GET /presence/:id - Presence Tracking', () => {
  let testUserId: ObjectId;

  beforeAll(async () => {
    await connectToDatabase();
    connectToRedis();
  });

  afterAll(async () => {
    await closeDatabase();
    await closeRedis();
  });

  beforeEach(async () => {
    const db = getDatabase();
    const usersCollection = db.collection<User>('users');

    // Clean up test data
    await usersCollection.deleteMany({ username: /^test-presence-/ });

    // Clean up Redis presence keys
    const redis = getRedisClient();
    const keys = await redis.keys('presence:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Insert test user
    const testUser: Partial<User> = {
      username: 'test-presence-user',
      email: 'test-presence@example.com',
      passwordHash: 'hashed_password',
      name: 'Test Presence User',
      contacts: [],
      blocked: [],
      lastSeen: new Date('2024-01-01T00:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(testUser as User);
    testUserId = result.insertedId;
  });

  it('should return online status when user has active presence', async () => {
    // Set user as online in Redis
    await updatePresence(testUserId.toString(), true);

    const response = await request(app).get(`/presence/${testUserId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.online).toBe(true);
    expect(response.body.lastSeen).toBeDefined();
  });

  it('should return offline status when user has no active presence', async () => {
    const response = await request(app).get(`/presence/${testUserId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.online).toBe(false);
    expect(response.body.lastSeen).toBe('2024-01-01T00:00:00.000Z');
  });

  it('should return 404 for non-existent user', async () => {
    const nonExistentId = new ObjectId();
    const response = await request(app).get(`/presence/${nonExistentId.toString()}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: 'Not Found',
      message: 'User not found',
    });
  });

  it('should return 400 for invalid user ID format', async () => {
    const response = await request(app).get('/presence/invalid-id');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Invalid user ID format',
    });
  });

  it('should update presence to online', async () => {
    await updatePresence(testUserId.toString(), true);

    const redis = getRedisClient();
    const presenceKey = `presence:${testUserId.toString()}`;
    const presenceData = await redis.get(presenceKey);

    expect(presenceData).toBeDefined();
    const presence = JSON.parse(presenceData!);
    expect(presence.online).toBe(true);
    expect(presence.lastSeen).toBeDefined();
  });

  it('should set TTL on presence key', async () => {
    await updatePresence(testUserId.toString(), true);

    const redis = getRedisClient();
    const presenceKey = `presence:${testUserId.toString()}`;
    const ttl = await redis.ttl(presenceKey);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300); // 5 minutes
  });

  it('should remove presence when user goes offline', async () => {
    // Set user online first
    await updatePresence(testUserId.toString(), true);

    // Verify presence exists
    const redis = getRedisClient();
    const presenceKey = `presence:${testUserId.toString()}`;
    let presenceData = await redis.get(presenceKey);
    expect(presenceData).toBeDefined();

    // Set user offline
    await updatePresence(testUserId.toString(), false);

    // Verify presence is removed
    presenceData = await redis.get(presenceKey);
    expect(presenceData).toBeNull();
  });

  it('should handle presence expiration after TTL', async () => {
    // Set user online with very short TTL for testing
    const redis = getRedisClient();
    const presenceKey = `presence:${testUserId.toString()}`;
    const presenceData = {
      online: true,
      lastSeen: new Date().toISOString(),
    };
    await redis.setex(presenceKey, 1, JSON.stringify(presenceData)); // 1 second TTL

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Check presence - should be offline
    const response = await request(app).get(`/presence/${testUserId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.body.online).toBe(false);
  });
});
