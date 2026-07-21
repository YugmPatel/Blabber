import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { getChatActionsCollection } from '../models/chat-action';
import { seedChatUsers } from '../test-fixtures';
import { buildActionsDigestEmail, remainingDigestActions } from '../actions-email-digest';
import { setActionsDigestEmailSenderForTest } from './chat-actions';
import { ActionEmailDigestProcessor } from '../action-email-digests';
import {
  createActionEmailDigestDeliveryIndexes,
  getActionEmailDigestDeliveriesCollection,
} from '../models/action-email-digest-delivery';
import {
  createActionEmailDigestPreferenceIndexes,
  getActionEmailDigestPreferencesCollection,
} from '../models/action-email-digest-preference';

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
    await db.collection('actionEmailDigestPreferences').deleteMany({});
    await db.collection('actionEmailDigestDeliveries').deleteMany({});
    await db.collection('processor_locks').deleteMany({});
    await createActionEmailDigestPreferenceIndexes();
    await createActionEmailDigestDeliveryIndexes();
    await seedChatUsers([mockUserId, otherUserId, adminUserId, outsiderUserId]);
    sendDigestMock = vi.fn(async () => true);
    setActionsDigestEmailSenderForTest(sendDigestMock);
  });

  afterEach(async () => {
    setActionsDigestEmailSenderForTest(async () => false);
    await closeDatabase();
  });

  async function insertGroupAction(params: {
    userId?: ObjectId;
    chatId?: ObjectId;
    title?: string;
    status?: string;
    deletedAt?: Date;
    participants?: ObjectId[];
  } = {}) {
    const now = new Date();
    const chatId = params.chatId || new ObjectId();
    const ownerId = params.userId || mockUserId;
    await getDatabase().collection('chats').updateOne(
      { _id: chatId },
      {
        $setOnInsert: {
          _id: chatId,
          type: 'group',
          groupKind: 'standard',
          participants: params.participants || [ownerId, otherUserId],
          admins: [ownerId],
          title: 'Daily Digest Crew',
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    await getChatActionsCollection().insertOne({
      _id: new ObjectId(),
      chatId,
      actionKey: `daily-${new ObjectId().toString()}`,
      type: 'task',
      title: params.title || 'Book elevator',
      status: (params.status || 'open') as any,
      assignedTo: { userId: ownerId.toString(), name: 'Me' },
      sourceMessageIds: [],
      ...(params.deletedAt ? { deletedAt: params.deletedAt } : {}),
      generatedByUserId: ownerId,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    } as any);
    return chatId;
  }

  async function enableDailyDigest(userId = mockUserId, patch: Partial<{ hourLocal: number; timezone: string }> = {}) {
    const now = new Date();
    await getActionEmailDigestPreferencesCollection().insertOne({
      userId,
      enabled: true,
      hourLocal: patch.hourLocal ?? 9,
      timezone: patch.timezone || 'UTC',
      createdAt: now,
      updatedAt: now,
    });
  }

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

  it('returns a disabled Daily Actions digest preference by default', async () => {
    const response = await request(app).get('/intelligence/actions/digest/preferences');

    expect(response.status).toBe(200);
    expect(response.body.preference).toMatchObject({
      enabled: false,
      hourLocal: 9,
      timezone: 'UTC',
    });
  });

  it('allows the authenticated user to enable and disable Daily Actions digest', async () => {
    const enabledResponse = await request(app)
      .patch('/intelligence/actions/digest/preferences')
      .send({ enabled: true, hourLocal: 8, timezone: 'America/Los_Angeles' });

    expect(enabledResponse.status).toBe(200);
    expect(enabledResponse.body.preference).toMatchObject({
      enabled: true,
      hourLocal: 8,
      timezone: 'America/Los_Angeles',
    });

    const disabledResponse = await request(app)
      .patch('/intelligence/actions/digest/preferences')
      .send({ enabled: false, hourLocal: 10, timezone: 'America/Los_Angeles' });

    expect(disabledResponse.status).toBe(200);
    expect(disabledResponse.body.preference).toMatchObject({
      enabled: false,
      hourLocal: 10,
      timezone: 'America/Los_Angeles',
    });
  });

  it('validates Daily Actions digest hour and timezone', async () => {
    const hourResponse = await request(app)
      .patch('/intelligence/actions/digest/preferences')
      .send({ enabled: true, hourLocal: 24, timezone: 'UTC' });
    expect(hourResponse.status).toBe(400);
    expect(hourResponse.body.message).toBe('hourLocal must be an integer from 0 to 23');

    const timezoneResponse = await request(app)
      .patch('/intelligence/actions/digest/preferences')
      .send({ enabled: true, hourLocal: 9, timezone: '   ' });
    expect(timezoneResponse.status).toBe(400);
    expect(timezoneResponse.body.message).toBe('timezone must be a non-empty string under 100 characters');
  });

  it('ignores client-supplied user IDs when updating Daily Actions digest preference', async () => {
    const response = await request(app)
      .patch('/intelligence/actions/digest/preferences')
      .send({ enabled: true, hourLocal: 9, timezone: 'UTC', userId: otherUserId.toString() });

    expect(response.status).toBe(200);
    const currentUserPreference = await getActionEmailDigestPreferencesCollection().findOne({ userId: mockUserId });
    const otherUserPreference = await getActionEmailDigestPreferencesCollection().findOne({ userId: otherUserId });
    expect(currentUserPreference?.enabled).toBe(true);
    expect(otherUserPreference).toBeNull();
  });

  it('daily digest processor sends one email per local day for enabled users with open Actions', async () => {
    await enableDailyDigest(mockUserId, { hourLocal: 9, timezone: 'UTC' });
    await insertGroupAction({ title: 'Book elevator' });
    await insertGroupAction({ title: 'Completed item', status: 'completed' });
    await insertGroupAction({ title: 'Deleted item', deletedAt: new Date() });
    await insertGroupAction({ title: 'Hidden item', participants: [otherUserId] });
    const sender = { send: vi.fn(async () => true) };

    const processor = new ActionEmailDigestProcessor(sender, () => new Date('2026-07-21T09:05:00.000Z'));
    const firstRun = await processor.runOnce();
    const secondRun = await processor.runOnce();
    const nextDayRun = await new ActionEmailDigestProcessor(sender, () => new Date('2026-07-22T09:05:00.000Z')).runOnce();

    expect(firstRun).toMatchObject({ checked: 1, reserved: 1, sent: 1 });
    expect(secondRun).toMatchObject({ checked: 1, reserved: 0, sent: 0 });
    expect(nextDayRun).toMatchObject({ checked: 1, reserved: 1, sent: 1 });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send.mock.calls[0][0].subject).toBe('Your Actions are waiting 👀');
    expect(sender.send.mock.calls[0][0].text).toContain('you still have 1 open Action');
    expect(sender.send.mock.calls[0][0].text).toContain('Book elevator');
    expect(sender.send.mock.calls[0][0].text).not.toContain('Completed item');
    expect(sender.send.mock.calls[0][0].text).not.toContain('Deleted item');
    expect(sender.send.mock.calls[0][0].text).not.toContain('Hidden item');

    const deliveries = await getActionEmailDigestDeliveriesCollection().find({ userId: mockUserId }).sort({ localDate: 1 }).toArray();
    expect(deliveries.map((delivery) => [delivery.localDate, delivery.status, delivery.count])).toEqual([
      ['2026-07-21', 'sent', 1],
      ['2026-07-22', 'sent', 1],
    ]);
  });

  it('daily digest processor skips disabled users and users with no open Actions', async () => {
    await getActionEmailDigestPreferencesCollection().insertOne({
      userId: mockUserId,
      enabled: false,
      hourLocal: 9,
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await enableDailyDigest(otherUserId, { hourLocal: 9, timezone: 'UTC' });
    const sender = { send: vi.fn(async () => true) };

    const result = await new ActionEmailDigestProcessor(sender, () => new Date('2026-07-21T09:05:00.000Z')).runOnce();

    expect(result).toMatchObject({ checked: 1, reserved: 1, skipped: 1, sent: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    const delivery = await getActionEmailDigestDeliveriesCollection().findOne({ userId: otherUserId, localDate: '2026-07-21' });
    expect(delivery).toMatchObject({ status: 'skipped', count: 0, errorCategory: 'no_open_actions' });
  });

  it('daily digest processor skips users without email', async () => {
    await enableDailyDigest(mockUserId, { hourLocal: 9, timezone: 'UTC' });
    await insertGroupAction({ title: 'Book elevator' });
    await getDatabase().collection('users').updateOne({ _id: mockUserId }, { $unset: { email: '' } });
    const sender = { send: vi.fn(async () => true) };

    const result = await new ActionEmailDigestProcessor(sender, () => new Date('2026-07-21T09:05:00.000Z')).runOnce();

    expect(result).toMatchObject({ checked: 1, reserved: 1, skipped: 1, sent: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    const delivery = await getActionEmailDigestDeliveriesCollection().findOne({ userId: mockUserId, localDate: '2026-07-21' });
    expect(delivery).toMatchObject({ status: 'skipped', count: 0, errorCategory: 'no_email' });
  });

  it('daily digest processor records sanitized failures without crashing', async () => {
    await enableDailyDigest(mockUserId, { hourLocal: 9, timezone: 'UTC' });
    await insertGroupAction({ title: 'Book elevator' });
    const sender = { send: vi.fn(async () => false) };

    const result = await new ActionEmailDigestProcessor(sender, () => new Date('2026-07-21T09:05:00.000Z')).runOnce();

    expect(result).toMatchObject({ checked: 1, reserved: 1, failed: 1, sent: 0 });
    const delivery = await getActionEmailDigestDeliveriesCollection().findOne({ userId: mockUserId, localDate: '2026-07-21' });
    expect(delivery).toMatchObject({ status: 'failed', count: 1, errorCategory: 'send_failed' });
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
