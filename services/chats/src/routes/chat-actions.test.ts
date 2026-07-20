import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getChatActionsCollection } from '../models/chat-action';
import { seedChatUsers } from '../test-fixtures';

const mockUserId = new ObjectId();
const otherUserId = new ObjectId();
const adminUserId = new ObjectId();
const outsiderUserId = new ObjectId();

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

describe('chat Actions routes', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('users').deleteMany({});
    await db.collection('chat_actions').deleteMany({});
    await db.collection('plan_this').deleteMany({});
    await db.collection('userSettings').deleteMany({});
    await seedChatUsers([mockUserId, otherUserId, adminUserId, outsiderUserId]);
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

  it('creates sourced group Actions without inventing an owner when no owner is provided', async () => {
    const db = getDatabase();
    const now = new Date();
    const chatId = new ObjectId();
    const messageId = new ObjectId();

    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      groupKind: 'standard',
      participants: [mockUserId, otherUserId],
      admins: [mockUserId],
      title: 'Apartment Move-in',
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('messages').insertOne({
      _id: messageId,
      chatId,
      senderId: otherUserId,
      type: 'text',
      body: 'Someone should check parking.',
      deletedFor: [],
      createdAt: now,
      updatedAt: now,
    });

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/actions`)
      .send({
        title: 'Check parking',
        sourceMessageIds: [messageId.toString()],
      });

    expect(response.status).toBe(201);
    expect(response.body.action).toMatchObject({
      title: 'Check parking',
      visibility: 'chat',
      sourceMessageIds: [messageId.toString()],
    });
    expect(response.body.action.assignedTo).toBeUndefined();
    expect(response.body.action.permissions).toMatchObject({
      canEdit: true,
      canDelete: true,
      canUpdateStatus: true,
    });
  });

  it('dedupes repeated sourced group Action creates by source and action key', async () => {
    const db = getDatabase();
    const now = new Date();
    const chatId = new ObjectId();
    const messageId = new ObjectId();

    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      groupKind: 'standard',
      participants: [mockUserId, otherUserId],
      admins: [mockUserId],
      title: 'Apartment Move-in',
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('messages').insertOne({
      _id: messageId,
      chatId,
      senderId: otherUserId,
      type: 'text',
      body: 'Someone needs to check renters insurance.',
      deletedFor: [],
      createdAt: now,
      updatedAt: now,
    });

    const payload = {
      title: 'Check renters insurance',
      sourceMessageIds: [messageId.toString()],
    };
    const firstResponse = await request(app).post(`/intelligence/chats/${chatId.toString()}/actions`).send(payload);
    const secondResponse = await request(app).post(`/intelligence/chats/${chatId.toString()}/actions`).send(payload);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.duplicate).toBe(true);
    expect(secondResponse.body.action.id).toBe(firstResponse.body.action.id);

    const count = await getChatActionsCollection().countDocuments({
      chatId,
      title: 'Check renters insurance',
      sourceMessageIds: messageId,
      deletedAt: { $exists: false },
    });
    expect(count).toBe(1);
  });

  it('rejects group Action owners who are not current group members', async () => {
    const db = getDatabase();
    const chatId = new ObjectId();
    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      groupKind: 'standard',
      participants: [mockUserId, otherUserId],
      admins: [mockUserId],
      title: 'Apartment Move-in',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/actions`)
      .send({
        title: 'Upload lease document',
        ownerUserId: outsiderUserId.toString(),
        sourceMessageIds: [],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Action owner must be a current group member');
  });

  it('prevents a non-admin group member from creating an Action for another member', async () => {
    const db = getDatabase();
    const chatId = new ObjectId();
    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      groupKind: 'standard',
      participants: [mockUserId, otherUserId, adminUserId],
      admins: [adminUserId],
      ownerId: adminUserId,
      title: 'Apartment Move-in',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/actions`)
      .send({
        title: 'Check renters insurance',
        ownerUserId: otherUserId.toString(),
        sourceMessageIds: [],
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Only a group admin can create an Action for another member.');
  });

  it('blocks non-members from viewing chat Actions without leaking data', async () => {
    const db = getDatabase();
    const chatId = new ObjectId();
    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      groupKind: 'standard',
      participants: [otherUserId],
      admins: [otherUserId],
      title: 'Private Group',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await getChatActionsCollection().insertOne({
      _id: new ObjectId(),
      chatId,
      actionKey: 'task:secret:manual:unassigned',
      type: 'task',
      title: 'Secret task',
      status: 'open',
      sourceMessageIds: [],
      generatedByUserId: otherUserId,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const response = await request(app).get(`/intelligence/chats/${chatId.toString()}/actions`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You are not a participant in this chat');
    expect(JSON.stringify(response.body)).not.toContain('Secret task');
  });
});
