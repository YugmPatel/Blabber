import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { createPushSubscriptionIndexes } from '../models/push-subscription';

describe('POST /push/subscribe', () => {
  beforeAll(async () => {
    await connectToDatabase();
    await createPushSubscriptionIndexes();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    // Clean up test data
    const db = getDatabase();
    await db.collection('pushSubscriptions').deleteMany({});
  });

  it('should create a new push subscription', async () => {
    const userId = new ObjectId().toString();
    const subscriptionData = {
      userId,
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test123',
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key',
        },
      },
    };

    const response = await request(app).post('/push/subscribe').send(subscriptionData);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
    });
    expect(response.body.subscriptionId).toBeDefined();

    // Verify in database
    const db = getDatabase();
    const subscription = await db.collection('pushSubscriptions').findOne({
      userId: new ObjectId(userId),
    });

    expect(subscription).toBeDefined();
    expect(subscription?.endpoint).toBe(subscriptionData.subscription.endpoint);
  });

  it('should return 200 for duplicate endpoint', async () => {
    const userId = new ObjectId().toString();
    const subscriptionData = {
      userId,
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test456',
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key',
        },
      },
    };

    // Create first subscription
    const firstResponse = await request(app).post('/push/subscribe').send(subscriptionData);
    expect(firstResponse.status).toBe(201);

    // Try to create duplicate
    const response = await request(app).post('/push/subscribe').send(subscriptionData);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Subscription already exists',
    });
  });

  it('should return 400 for invalid userId', async () => {
    const subscriptionData = {
      userId: 'invalid-id',
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test789',
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key',
        },
      },
    };

    const response = await request(app).post('/push/subscribe').send(subscriptionData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for missing keys', async () => {
    const userId = new ObjectId().toString();
    const subscriptionData = {
      userId,
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test999',
        keys: {
          p256dh: 'test-p256dh-key',
          // Missing auth key
        },
      },
    };

    const response = await request(app).post('/push/subscribe').send(subscriptionData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for invalid endpoint URL', async () => {
    const userId = new ObjectId().toString();
    const subscriptionData = {
      userId,
      subscription: {
        endpoint: 'not-a-valid-url',
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key',
        },
      },
    };

    const response = await request(app).post('/push/subscribe').send(subscriptionData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });
});
