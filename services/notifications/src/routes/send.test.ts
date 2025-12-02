import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import webpush from 'web-push';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { createPushSubscription, createPushSubscriptionIndexes } from '../models/push-subscription';

// Mock web-push
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

describe('POST /send', () => {
  beforeAll(async () => {
    await connectToDatabase();
    await createPushSubscriptionIndexes();

    // Set up environment variables for VAPID
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    // Clean up test data
    const db = getDatabase();
    await db.collection('pushSubscriptions').deleteMany({});

    // Reset mocks
    vi.clearAllMocks();
  });

  it('should send push notification to all user subscriptions', async () => {
    const userId = new ObjectId();

    // Create multiple subscriptions for the user
    await createPushSubscription({
      userId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub1',
      keys: {
        p256dh: 'test-p256dh-key-1',
        auth: 'test-auth-key-1',
      },
    });

    await createPushSubscription({
      userId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub2',
      keys: {
        p256dh: 'test-p256dh-key-2',
        auth: 'test-auth-key-2',
      },
    });

    // Mock successful notification send
    vi.mocked(webpush.sendNotification).mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });

    const notificationData = {
      userId: userId.toString(),
      title: 'New Message',
      body: 'You have a new message',
      data: {
        chatId: 'chat123',
        messageId: 'msg456',
      },
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      sent: 2,
      failed: 0,
      total: 2,
    });

    // Verify web-push was called twice
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('should return 200 when user has no subscriptions', async () => {
    const userId = new ObjectId();

    const notificationData = {
      userId: userId.toString(),
      title: 'New Message',
      body: 'You have a new message',
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'No subscriptions found',
      sent: 0,
    });

    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('should clean up expired subscriptions on 410 Gone', async () => {
    const userId = new ObjectId();

    const subscription = await createPushSubscription({
      userId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/expired',
      keys: {
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key',
      },
    });

    // Mock 410 Gone error
    vi.mocked(webpush.sendNotification).mockRejectedValue({
      statusCode: 410,
      message: 'Gone',
    });

    const notificationData = {
      userId: userId.toString(),
      title: 'New Message',
      body: 'You have a new message',
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(200);
    expect(response.body.failed).toBe(1);

    // Verify subscription was deleted
    const db = getDatabase();
    const deletedSub = await db.collection('pushSubscriptions').findOne({
      _id: subscription._id,
    });

    expect(deletedSub).toBeNull();
  });

  it('should handle partial failures gracefully', async () => {
    const userId = new ObjectId();

    await createPushSubscription({
      userId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/success',
      keys: {
        p256dh: 'test-p256dh-key-1',
        auth: 'test-auth-key-1',
      },
    });

    await createPushSubscription({
      userId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/failure',
      keys: {
        p256dh: 'test-p256dh-key-2',
        auth: 'test-auth-key-2',
      },
    });

    // Mock one success and one failure
    vi.mocked(webpush.sendNotification)
      .mockResolvedValueOnce({
        statusCode: 201,
        body: '',
        headers: {},
      })
      .mockRejectedValueOnce({
        statusCode: 500,
        message: 'Internal Server Error',
      });

    const notificationData = {
      userId: userId.toString(),
      title: 'New Message',
      body: 'You have a new message',
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      sent: 1,
      failed: 1,
      total: 2,
    });
  });

  it('should return 400 for invalid userId', async () => {
    const notificationData = {
      userId: 'invalid-id',
      title: 'New Message',
      body: 'You have a new message',
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for missing title', async () => {
    const userId = new ObjectId();

    const notificationData = {
      userId: userId.toString(),
      body: 'You have a new message',
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should return 400 for missing body', async () => {
    const userId = new ObjectId();

    const notificationData = {
      userId: userId.toString(),
      title: 'New Message',
    };

    const response = await request(app).post('/send').send(notificationData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });
});
