import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { seedChatUsers } from '../test-fixtures';

const mockUserId = new ObjectId();
const otherUserId = new ObjectId();
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

async function seedGroup(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const result = await getDatabase().collection('chats').insertOne({
    type: 'group',
    groupKind: 'standard',
    title: 'Group Brain QA',
    participants: [mockUserId, otherUserId],
    admins: [mockUserId],
    aiEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  return result.insertedId;
}

async function seedMessage(chatId: ObjectId, body: string, overrides: Record<string, unknown> = {}) {
  const result = await getDatabase().collection('messages').insertOne({
    chatId,
    senderId: otherUserId,
    body,
    type: 'text',
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return result.insertedId;
}

describe('Group Brain routes', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('chat_actions').deleteMany({});
    await db.collection('chat_decisions').deleteMany({});
    await db.collection('chat_summaries').deleteMany({});
    await db.collection('chat_waiting_on').deleteMany({});
    await db.collection('userSettings').deleteMany({});
    await db.collection('users').deleteMany({});
    await seedChatUsers([mockUserId, otherUserId, outsiderUserId]);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('answers empty groups with insufficient evidence instead of fake decisions', async () => {
    const chatId = await seedGroup();

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/brain/ask`)
      .send({ question: 'What did we decide?' });

    expect(response.status).toBe(200);
    expect(response.body.answerState).toBe('insufficient_evidence');
    expect(response.body.sourceMessageIds).toEqual([]);
    expect(response.body.answer).not.toMatch(/decided|finalized.*Xfinity/i);
  });

  it('blocks Group Brain for direct chats', async () => {
    const direct = await getDatabase().collection('chats').insertOne({
      type: 'direct',
      participants: [mockUserId, otherUserId],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post(`/intelligence/chats/${direct.insertedId.toString()}/brain/ask`)
      .send({ question: 'What did we decide?' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Group Brain is available for group chats only');
  });

  it('blocks Group Brain when group AI Intelligence is disabled', async () => {
    const chatId = await seedGroup({ aiEnabled: false });
    await seedMessage(chatId, 'Decision: use Xfinity.');

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/brain/ask`)
      .send({ question: 'What did we decide?' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('AI Intelligence is disabled for this group.');
    expect(JSON.stringify(response.body)).not.toContain('Xfinity');
  });

  it('blocks non-members without leaking group content', async () => {
    const chatId = await seedGroup({ participants: [otherUserId], admins: [otherUserId] });
    await seedMessage(chatId, 'Decision: secret provider is Verizon.');

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/brain/ask`)
      .send({ question: 'What did we decide?' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('You are not a participant in this chat');
    expect(JSON.stringify(response.body)).not.toContain('Verizon');
  });

  it('excludes messages deleted for the viewer from answers and source links', async () => {
    const chatId = await seedGroup();
    await seedMessage(chatId, 'Decision: use Verizon.', { deletedFor: [mockUserId], createdAt: new Date(Date.now() - 1000) });
    const activeMessageId = await seedMessage(chatId, 'Decision: use Xfinity.', { createdAt: new Date() });

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/brain/ask`)
      .send({ question: 'What did we decide?' });

    expect(response.status).toBe(200);
    expect(response.body.answer).toMatch(/Xfinity/i);
    expect(response.body.answer).not.toMatch(/Verizon/i);
    expect(response.body.sourceMessageIds).toEqual([activeMessageId.toString()]);
    expect(response.body.sources?.[0]?.messageId).toBe(activeMessageId.toString());
  });

  it('does not include soft-deleted Actions in aggregated Group Brain state', async () => {
    const chatId = await seedGroup();
    const sourceMessageId = await seedMessage(chatId, 'We need to check renters insurance.');
    await getDatabase().collection('chat_actions').insertMany([
      {
        _id: new ObjectId(),
        chatId,
        actionKey: 'task:active',
        type: 'task',
        title: 'Check renters insurance',
        status: 'open',
        sourceMessageIds: [sourceMessageId],
        generatedByUserId: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        chatId,
        actionKey: 'task:deleted-secret',
        type: 'task',
        title: 'Deleted secret task',
        status: 'open',
        sourceMessageIds: [sourceMessageId],
        deletedAt: new Date(),
        generatedByUserId: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const response = await request(app).get(`/intelligence/chats/${chatId.toString()}/brain`);

    expect(response.status).toBe(200);
    expect(response.body.brain.actions.map((action: any) => action.title)).toEqual(['Check renters insurance']);
    expect(JSON.stringify(response.body)).not.toContain('Deleted secret task');
  });

  it('treats deleted groups as inaccessible for Group Brain', async () => {
    const chatId = await seedGroup({ deletedAt: new Date() });
    await seedMessage(chatId, 'Decision: deleted group uses Verizon.');

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/brain/ask`)
      .send({ question: 'What did we decide?' });

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Verizon');
  });
});
