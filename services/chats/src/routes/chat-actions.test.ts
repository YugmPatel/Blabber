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

  it('creates, lists, updates, and deletes standalone My Actions', async () => {
    const createResponse = await request(app)
      .post('/intelligence/actions/mine')
      .send({
        title: 'Finalize Xfinity WiFi',
        description: 'Pick the apartment internet plan.',
        sourceMessageIds: [],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.action).toMatchObject({
      title: 'Finalize Xfinity WiFi',
      description: 'Pick the apartment internet plan.',
      visibility: 'personal',
      personalOwnerUserId: mockUserId.toString(),
      chatTitle: 'My Actions',
    });
    expect(createResponse.body.action.permissions).toMatchObject({
      canEdit: true,
      canDelete: true,
      canUpdateStatus: true,
    });

    const listResponse = await request(app).get('/intelligence/actions/mine');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.actions.map((action: any) => action.title)).toContain('Finalize Xfinity WiFi');

    const actionId = createResponse.body.action.id;
    const updateResponse = await request(app)
      .patch(`/intelligence/actions/${actionId}`)
      .send({ title: 'Finalize Xfinity WiFi plan', status: 'completed' });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.action).toMatchObject({
      title: 'Finalize Xfinity WiFi plan',
      status: 'completed',
      chatTitle: 'My Actions',
    });

    const deleteResponse = await request(app)
      .delete(`/intelligence/actions/${actionId}`)
      .send({ reason: 'Demo cleanup' });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.action.deletedAt).toBeTruthy();

    const finalListResponse = await request(app).get('/intelligence/actions/mine');
    expect(finalListResponse.status).toBe(200);
    expect(finalListResponse.body.actions.map((action: any) => action.id)).not.toContain(actionId);
  });

  it('dedupes active standalone My Actions for fast repeated clicks', async () => {
    const payload = { title: 'Upload lease document', sourceMessageIds: [] };

    const firstResponse = await request(app).post('/intelligence/actions/mine').send(payload);
    const secondResponse = await request(app).post('/intelligence/actions/mine').send(payload);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.duplicate).toBe(true);
    expect(secondResponse.body.action.id).toBe(firstResponse.body.action.id);

    const count = await getChatActionsCollection().countDocuments({
      visibility: 'personal',
      personalOwnerUserId: mockUserId,
      'metadata.origin': 'manual_my_actions',
      title: 'Upload lease document',
      deletedAt: { $exists: false },
    });
    expect(count).toBe(1);
  });
});
