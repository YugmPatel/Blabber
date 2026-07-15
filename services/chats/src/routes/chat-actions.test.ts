import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getChatActionsCollection } from '../models/chat-action';
import { seedChatUsers } from '../test-fixtures';

const mockUserId = new ObjectId();

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

describe('GET /intelligence/actions/mine', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('users').deleteMany({});
    await db.collection('chat_actions').deleteMany({});
    await db.collection('plan_this').deleteMany({});
    await db.collection('userSettings').deleteMany({});
    await seedChatUsers([mockUserId]);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('marks actions from an ended temporary group with chatEndedAt, and leaves an active group unmarked', async () => {
    const db = getDatabase();

    const activeChat = await db.collection('chats').insertOne({
      type: 'group',
      groupKind: 'standard',
      participants: [mockUserId],
      admins: [mockUserId],
      title: 'Active Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const endedChat = await db.collection('chats').insertOne({
      type: 'group',
      groupKind: 'temporary',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      endedAt: new Date(Date.now() - 30 * 60 * 1000),
      participants: [mockUserId],
      admins: [mockUserId],
      title: 'Ended Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    await getChatActionsCollection().insertMany([
      {
        _id: new ObjectId(),
        chatId: activeChat.insertedId,
        actionKey: 'active-action',
        type: 'task',
        title: 'Active group task',
        status: 'open',
        assignedTo: { userId: mockUserId.toString(), name: 'Me' },
        sourceMessageIds: [],
        generatedByUserId: mockUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        _id: new ObjectId(),
        chatId: endedChat.insertedId,
        actionKey: 'ended-action',
        type: 'task',
        title: 'Ended group task',
        status: 'open',
        assignedTo: { userId: mockUserId.toString(), name: 'Me' },
        sourceMessageIds: [],
        generatedByUserId: mockUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
    ]);

    const response = await request(app).get('/intelligence/actions/mine');

    expect(response.status).toBe(200);
    const byTitle = new Map(response.body.actions.map((action: any) => [action.title, action]));

    expect(byTitle.get('Active group task').chatEndedAt).toBeUndefined();
    expect(byTitle.get('Ended group task').chatEndedAt).toBeDefined();
  });
});
