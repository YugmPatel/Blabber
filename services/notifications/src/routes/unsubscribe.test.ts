import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { createPushSubscription, createPushSubscriptionIndexes } from '../models/push-subscription';

describe('POST /push/unsubscribe', () => {
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

  it('should delete an existing push subscription', async () => {
    const userId = new ObjectId();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/test123';

    // Create a subscription first
    await createPushSubscription({
      userId,
      endpoint,
      keys: {
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key',
      },
    });

    const response = await request(app).post('/push/unsubscribe').send({ endpoint });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Push subscription deleted',
    });

    // Verify deletion in database
    const db = getDatabase();
    const subscription = await db.collection('pushSubscriptions').findOne({ endpoint });

    expect(subscription).toBeNull();
  });

  it('should return 404 for non-existent subscription', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/nonexistent';

    const response = await request(app).post('/push/unsubscribe').send({ endpoint });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: 'Not Found',
      message: 'Push subscription not found',
    });
  });

  it('should return 400 for invalid endpoint URL', async () => {
    const response = await request(app).post('/push/unsubscribe').send({
      endpoint: 'not-a-valid-url',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for missing endpoint', async () => {
    const response = await request(app).post('/push/unsubscribe').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });
});
