import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { EventType } from '@repo/types';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { seedChatUsers } from '../test-fixtures';

const mockUserId = new ObjectId();
const mockPublish = vi.fn().mockResolvedValue(undefined);

vi.mock('@repo/utils', async () => {
  const actual = await vi.importActual('@repo/utils');
  return {
    ...actual,
    createAuthMiddleware: () => (req: any, _res: any, next: any) => {
      req.user = { userId: mockUserId.toString() };
      next();
    },
  };
});

vi.mock('../pubsub', () => ({
  getPubSub: () => ({ publish: mockPublish }),
}));

describe('Group moderation settings', () => {
  beforeEach(async () => {
    await connectToDatabase();
    mockPublish.mockClear();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('users').deleteMany({});
    await seedChatUsers([mockUserId]);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('PATCH /:id/moderation/settings', () => {
    it('switches a group to admins-only and publishes a chat-updated event so other members refresh without a manual reload', async () => {
      const db = getDatabase();
      const member = new ObjectId();
      await seedChatUsers([member]);
      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, member],
        admins: [mockUserId],
        sendMode: 'everyone',
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const chatId = result.insertedId;

      const response = await request(app)
        .patch(`/${chatId.toString()}/moderation/settings`)
        .send({ sendMode: 'admins_only' });

      expect(response.status).toBe(200);
      expect(response.body.sendMode).toBe('admins_only');

      const updated = await db.collection('chats').findOne({ _id: chatId });
      expect(updated?.sendMode).toBe('admins_only');

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const published = mockPublish.mock.calls[0][0];
      expect(published.type).toBe(EventType.CHAT_UPDATED);
      expect(published.data.chatId).toBe(chatId.toString());
    });

    it('switches a group back to everyone-can-send', async () => {
      const db = getDatabase();
      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId],
        admins: [mockUserId],
        sendMode: 'admins_only',
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const chatId = result.insertedId;

      const response = await request(app)
        .patch(`/${chatId.toString()}/moderation/settings`)
        .send({ sendMode: 'everyone' });

      expect(response.status).toBe(200);
      expect(response.body.sendMode).toBe('everyone');

      const updated = await db.collection('chats').findOne({ _id: chatId });
      expect(updated?.sendMode).toBe('everyone');
    });

    it('rejects a non-admin changing send permissions', async () => {
      const db = getDatabase();
      const admin = new ObjectId();
      await seedChatUsers([admin]);
      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, admin],
        admins: [admin],
        sendMode: 'everyone',
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const chatId = result.insertedId;

      const response = await request(app)
        .patch(`/${chatId.toString()}/moderation/settings`)
        .send({ sendMode: 'admins_only' });

      expect(response.status).toBe(403);
      const updated = await db.collection('chats').findOne({ _id: chatId });
      expect(updated?.sendMode).toBe('everyone');
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('rejects an invalid sendMode value', async () => {
      const db = getDatabase();
      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const chatId = result.insertedId;

      const response = await request(app)
        .patch(`/${chatId.toString()}/moderation/settings`)
        .send({ sendMode: 'nobody' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /:id/moderation/members/:userId/restrict', () => {
    it('restricts a member and publishes a chat-updated event', async () => {
      const db = getDatabase();
      const member = new ObjectId();
      await seedChatUsers([member]);
      const result = await db.collection('chats').insertOne({
        type: 'group',
        participants: [mockUserId, member],
        admins: [mockUserId],
        title: 'Test Group',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const chatId = result.insertedId;

      const response = await request(app).post(
        `/${chatId.toString()}/moderation/members/${member.toString()}/restrict`
      );

      expect(response.status).toBe(200);
      expect(response.body.restricted).toBe(true);

      const updated = await db.collection('chats').findOne({ _id: chatId });
      expect(updated?.memberRestrictions).toHaveLength(1);
      expect(updated?.memberRestrictions[0].userId.toString()).toBe(member.toString());
      expect(mockPublish).toHaveBeenCalledTimes(1);
    });
  });
});
