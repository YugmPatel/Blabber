import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getChatActionsCollection } from '../models/chat-action';
import { seedChatUsers } from '../test-fixtures';
import { buildActionsDigestEmail, remainingDigestActions } from '../actions-email-digest';
import { setActionsDigestEmailSenderForTest } from './chat-actions';

const mockUserId = new ObjectId();
const otherUserId = new ObjectId();
const adminUserId = new ObjectId();
const outsiderUserId = new ObjectId();
let sendDigestMock: ReturnType<typeof vi.fn>;

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
    sendDigestMock = vi.fn(async () => true);
    setActionsDigestEmailSenderForTest(sendDigestMock);
  });

  afterEach(async () => {
    setActionsDigestEmailSenderForTest(async () => false);
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

  it('emails a My Actions digest only to the current user email', async () => {
    const db = getDatabase();
    const now = new Date();
    const chatId = new ObjectId();
    const outsiderChatId = new ObjectId();
    const endedChatId = new ObjectId();

    await db.collection('chats').insertMany([
      {
        _id: chatId,
        type: 'group',
        groupKind: 'standard',
        participants: [mockUserId, otherUserId],
        admins: [mockUserId],
        title: 'Move Crew',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: outsiderChatId,
        type: 'group',
        groupKind: 'standard',
        participants: [otherUserId],
        admins: [otherUserId],
        title: 'Hidden Crew',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: endedChatId,
        type: 'group',
        groupKind: 'temporary',
        participants: [mockUserId],
        admins: [mockUserId],
        title: 'Ended Crew',
        expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
        endedAt: new Date(now.getTime() - 30 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await getChatActionsCollection().insertMany([
      {
        _id: new ObjectId(),
        chatId,
        actionKey: 'assigned-open',
        type: 'task',
        title: 'Book elevator',
        status: 'open',
        assignedTo: { userId: mockUserId.toString(), name: 'Me' },
        createdBy: { userId: otherUserId.toString(), name: 'Other' },
        dueAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        sourceMessageIds: [],
        generatedByUserId: otherUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        _id: new ObjectId(),
        chatId,
        actionKey: 'created-in-progress',
        type: 'task',
        title: 'Send packing checklist',
        status: 'in_progress',
        createdBy: { userId: mockUserId.toString(), name: 'Me' },
        dueAt: now,
        sourceMessageIds: [],
        generatedByUserId: mockUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        _id: new ObjectId(),
        chatId,
        actionKey: 'done',
        type: 'task',
        title: 'Already done',
        status: 'completed',
        assignedTo: { userId: mockUserId.toString(), name: 'Me' },
        sourceMessageIds: [],
        generatedByUserId: mockUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        _id: new ObjectId(),
        chatId: outsiderChatId,
        actionKey: 'hidden',
        type: 'task',
        title: 'Should not leak',
        status: 'open',
        assignedTo: { userId: mockUserId.toString(), name: 'Me' },
        sourceMessageIds: [],
        generatedByUserId: otherUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        _id: new ObjectId(),
        chatId: endedChatId,
        actionKey: 'ended',
        type: 'task',
        title: 'Ended group item',
        status: 'open',
        assignedTo: { userId: mockUserId.toString(), name: 'Me' },
        sourceMessageIds: [],
        generatedByUserId: mockUserId,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      } as any,
    ]);

    const response = await request(app)
      .post('/intelligence/actions/digest/email')
      .send({ recipient: 'attacker@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sent: true,
      count: 2,
      message: 'Actions digest sent to your email.',
    });
    expect(sendDigestMock).toHaveBeenCalledTimes(1);
    const message = sendDigestMock.mock.calls[0][0];
    expect(message.to).toBe(`user_${mockUserId.toString()}@example.com`);
    expect(message.to).not.toBe('attacker@example.com');
    expect(message.subject).toBe('Your Actions are waiting 👀');
    expect(message.text).toContain('Book elevator');
    expect(message.text).toContain('Send packing checklist');
    expect(message.text).toContain('Move Crew');
    expect(message.text).not.toContain('Already done');
    expect(message.text).not.toContain('Should not leak');
    expect(message.text).not.toContain('Ended group item');
    expect(message.html).toContain('Open My Actions');
  });

  it('returns a no-actions digest response without sending email', async () => {
    const response = await request(app).post('/intelligence/actions/digest/email');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sent: false,
      count: 0,
      message: 'No open Actions to email.',
    });
    expect(sendDigestMock).not.toHaveBeenCalled();
  });

  it('returns a clean error when the Actions digest email cannot be sent', async () => {
    sendDigestMock = vi.fn(async () => false);
    setActionsDigestEmailSenderForTest(sendDigestMock);
    const db = getDatabase();
    const now = new Date();
    const chatId = new ObjectId();

    await db.collection('chats').insertOne({
      _id: chatId,
      type: 'group',
      groupKind: 'standard',
      participants: [mockUserId],
      admins: [mockUserId],
      title: 'Errands',
      createdAt: now,
      updatedAt: now,
    });
    await getChatActionsCollection().insertOne({
      _id: new ObjectId(),
      chatId,
      actionKey: 'open',
      type: 'task',
      title: 'Pick up keys',
      status: 'open',
      assignedTo: { userId: mockUserId.toString(), name: 'Me' },
      sourceMessageIds: [],
      generatedByUserId: mockUserId,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    } as any);

    const response = await request(app).post('/intelligence/actions/digest/email');

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      error: 'Bad Gateway',
      message: 'Could not send digest. Please try again.',
    });
    expect(sendDigestMock).toHaveBeenCalledTimes(1);
  });

  it('filters, dedupes, and sorts remaining digest Actions', () => {
    const now = new Date('2026-07-21T16:00:00.000Z');
    const duplicateId = new ObjectId().toString();
    const remaining = remainingDigestActions([
      {
        id: duplicateId,
        chatId: 'chat-1',
        type: 'task',
        title: 'Upcoming item',
        status: 'open',
        dueAt: '2026-07-24T10:00:00.000Z',
        sourceMessageIds: [],
      } as any,
      {
        id: duplicateId,
        chatId: 'chat-1',
        type: 'task',
        title: 'Duplicate upcoming item',
        status: 'open',
        dueAt: '2026-07-24T10:00:00.000Z',
        sourceMessageIds: [],
      } as any,
      {
        id: 'completed',
        chatId: 'chat-1',
        type: 'task',
        title: 'Completed item',
        status: 'completed',
        sourceMessageIds: [],
      } as any,
      {
        id: 'deleted',
        chatId: 'chat-1',
        type: 'task',
        title: 'Deleted item',
        status: 'open',
        deletedAt: now.toISOString(),
        sourceMessageIds: [],
      } as any,
      {
        id: 'ended',
        chatId: 'chat-1',
        type: 'task',
        title: 'Ended group item',
        status: 'open',
        chatEndedAt: now.toISOString(),
        sourceMessageIds: [],
      } as any,
      {
        id: 'cancelled-plan',
        chatId: 'chat-1',
        type: 'task',
        title: 'Cancelled plan item',
        status: 'open',
        metadata: { planStatus: 'cancelled' },
        sourceMessageIds: [],
      } as any,
      {
        id: 'today',
        chatId: 'chat-1',
        type: 'task',
        title: 'Today item',
        status: 'in_progress',
        dueAt: '2026-07-21T10:00:00.000Z',
        sourceMessageIds: [],
      } as any,
      {
        id: 'overdue',
        chatId: 'chat-1',
        type: 'task',
        title: 'Overdue item',
        status: 'open',
        dueAt: '2026-07-20T10:00:00.000Z',
        sourceMessageIds: [],
      } as any,
      {
        id: 'none',
        chatId: 'chat-1',
        type: 'task',
        title: 'No due item',
        status: 'open',
        sourceMessageIds: [],
      } as any,
    ], now);

    expect(remaining.map((action) => action.title)).toEqual([
      'Overdue item',
      'Today item',
      'Upcoming item',
      'No due item',
    ]);
  });

  it('builds grouped text and HTML for the Actions digest', () => {
    const digest = buildActionsDigestEmail({
      userName: 'Yugm Patel',
      userEmail: 'yugm@example.com',
      now: new Date('2026-07-21T16:00:00.000Z'),
      actions: [
        {
          id: 'a',
          chatId: 'chat-1',
          chatTitle: 'Roommates',
          type: 'task',
          title: 'Pay utilities',
          description: 'Split the bill before dinner.',
          status: 'open',
          dueAt: '2026-07-20T10:00:00.000Z',
          sourceMessageIds: [],
        } as any,
        {
          id: 'b',
          chatId: 'chat-2',
          chatTitle: 'My Actions',
          type: 'task',
          title: 'Renew parking pass',
          status: 'in_progress',
          sourceMessageIds: [],
        } as any,
      ],
    });

    expect(digest.count).toBe(2);
    expect(digest.subject).toBe('Your Actions are waiting 👀');
    expect(digest.text).toContain('Hi Yugm,');
    expect(digest.text).toContain('Overdue');
    expect(digest.text).toContain('No due date');
    expect(digest.text).toContain('Open My Actions');
    expect(digest.html).toContain('Pay utilities');
    expect(digest.html).toContain('Renew parking pass');
    expect(digest.html).toContain('Roommates');
  });
});
