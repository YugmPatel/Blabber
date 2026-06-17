import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';

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

describe('Chat intelligence routes', () => {
  beforeEach(async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_MOCK_FALLBACK;
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('chat_summaries').deleteMany({});
  });

  afterEach(async () => {
    await closeDatabase();
  });

  async function seedParticipantChat(): Promise<ObjectId> {
    const db = getDatabase();
    const otherUserId = new ObjectId();

    const chatResult = await db.collection('chats').insertOne({
      type: 'direct',
      participants: [mockUserId, otherUserId],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = chatResult.insertedId;

    await db.collection('messages').insertMany([
      {
        chatId,
        senderId: otherUserId,
        body: 'Kickoff thread — https://example.com/doc',
        reactions: [],
        status: 'sent' as const,
        deletedFor: [],
        createdAt: new Date(Date.now() - 2000),
      },
      {
        chatId,
        senderId: mockUserId,
        body: 'Sounds good — random meme tangent here',
        reactions: [],
        status: 'sent' as const,
        deletedFor: [],
        createdAt: new Date(Date.now() - 1000),
      },
    ]);

    return chatId;
  }

  it('GET /intelligence/chats/:chatId/summary returns null when no summary exists', async () => {
    const db = getDatabase();
    const otherUserId = new ObjectId();

    const chatResult = await db.collection('chats').insertOne({
      type: 'direct',
      participants: [mockUserId, otherUserId],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = chatResult.insertedId.toString();

    const response = await request(app).get(`/intelligence/chats/${chatId}/summary`);

    expect(response.status).toBe(200);
    expect(response.body.summary).toBeNull();
  });

  it('POST /intelligence/chats/:chatId/summarize returns structured JSON and persists', async () => {
    const chatId = await seedParticipantChat();
    const id = chatId.toString();

    const postResponse = await request(app)
      .post(`/intelligence/chats/${id}/summarize`)
      .send({ messageLimit: 200 });

    expect(postResponse.status).toBe(200);
    expect(postResponse.body.summary).toBeDefined();
    expect(postResponse.body.summary.summary).toBeTypeOf('string');
    expect(postResponse.body.summary.decisions).toBeInstanceOf(Array);
    expect(postResponse.body.summary.tasks).toBeInstanceOf(Array);
    expect(postResponse.body.summary.questionsForMe).toBeInstanceOf(Array);
    expect(postResponse.body.summary.importantLinks).toBeInstanceOf(Array);
    expect(postResponse.body.summary.waitingOn).toBeInstanceOf(Array);
    expect(postResponse.body.summary.noise).toBeInstanceOf(Array);
    expect(postResponse.body.summary.sourceMessageIds).toBeInstanceOf(Array);
    expect(postResponse.body.summary.generatedAt).toBeTruthy();

    const getResponse = await request(app).get(`/intelligence/chats/${id}/summary`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.summary).toEqual(postResponse.body.summary);
  });

  it('POST /intelligence/chats/:chatId/summarize returns 400 for invalid payload', async () => {
    const chatId = await seedParticipantChat();

    const response = await request(app)
      .post(`/intelligence/chats/${chatId.toString()}/summarize`)
      .send({ messageLimit: 5 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('POST /intelligence/chats/:chatId/summarize returns 403 when user is not a participant', async () => {
    const db = getDatabase();
    const user1 = new ObjectId();
    const user2 = new ObjectId();

    const chatResult = await db.collection('chats').insertOne({
      type: 'direct',
      participants: [user1, user2],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).post(
      `/intelligence/chats/${chatResult.insertedId.toString()}/summarize`
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
  });
});
