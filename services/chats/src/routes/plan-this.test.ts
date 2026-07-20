import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
import { seedChatUsers } from '../test-fixtures';
import { getPlanThisCollection } from '../models/plan-this';

const mockUserId = new ObjectId();
const otherUserId = new ObjectId();
const outsiderUserId = new ObjectId();
const sourceAuthorId = new ObjectId();

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

async function seedChat(type: 'direct' | 'group' = 'group', overrides: Record<string, unknown> = {}) {
  const result = await getDatabase().collection('chats').insertOne({
    type,
    title: type === 'group' ? 'Apartment Move-in' : undefined,
    participants: [mockUserId, otherUserId],
    admins: type === 'group' ? [mockUserId] : [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return result.insertedId;
}

async function seedPost(overrides: Record<string, unknown> = {}) {
  const result = await getDatabase().collection('posts').insertOne({
    authorUserId: sourceAuthorId,
    body: 'Great brunch spot near the new apartment.',
    visibility: 'public',
    discoveryTopicIds: ['food', 'move-in'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return result.insertedId;
}

async function seedReel(overrides: Record<string, unknown> = {}) {
  const result = await getDatabase().collection('reels').insertOne({
    authorUserId: sourceAuthorId,
    caption: 'Touring a weekend hiking trail.',
    visibility: 'public',
    publishState: 'published',
    processingStatus: 'ready',
    reelDiscoverable: true,
    reelTopicIds: ['outdoors'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return result.insertedId;
}

async function createPlan(chatId: ObjectId, sourceId: ObjectId, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/plan-this/plans')
    .send({
      source: { type: 'post', id: sourceId.toString() },
      chatId: chatId.toString(),
      participantUserIds: [mockUserId.toString(), otherUserId.toString()],
      title: 'Brunch near the apartment',
      description: 'Coordinate a brunch after move-in.',
      suggestedAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      suggestedLocation: 'Cafe Nova',
      budgetNotes: 'Keep it under $40 each.',
      checklist: ['Pick a time', 'Confirm headcount'],
      clientRequestId: new ObjectId().toString(),
      ...overrides,
    });
}

describe('Plan This routes', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('chats').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('plan_this_plans').deleteMany({});
    await db.collection('chat_actions').deleteMany({});
    await db.collection('posts').deleteMany({});
    await db.collection('reels').deleteMany({});
    await db.collection('users').deleteMany({});
    await db.collection('userSettings').deleteMany({});
    await db.collection('user_blocks').deleteMany({});
    await seedChatUsers([mockUserId, otherUserId, outsiderUserId, sourceAuthorId]);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await closeDatabase();
  });

  it('reports public post and reel eligibility without leaking deleted sources', async () => {
    const postId = await seedPost();
    const reelId = await seedReel();
    const deletedPostId = await seedPost({ deletedAt: new Date(), body: 'Deleted private brunch details' });

    const post = await request(app).get('/plan-this/eligibility').query({ type: 'post', id: postId.toString() });
    const reel = await request(app).get('/plan-this/eligibility').query({ type: 'reel', id: reelId.toString() });
    const deleted = await request(app).get('/plan-this/eligibility').query({ type: 'post', id: deletedPostId.toString() });

    expect(post.status).toBe(200);
    expect(post.body.eligible).toBe(true);
    expect(post.body.source.previewLabel).toMatch(/brunch spot/i);
    expect(reel.status).toBe(200);
    expect(reel.body.eligible).toBe(true);
    expect(reel.body.source.previewLabel).toMatch(/hiking trail/i);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ eligible: false, source: null });
  });

  it('creates one proposal and one chat card for repeated submits with the same clientRequestId', async () => {
    const chatId = await seedChat('direct');
    const postId = await seedPost();
    const clientRequestId = 'demo-request-1';

    const first = await createPlan(chatId, postId, { clientRequestId });
    const second = await createPlan(chatId, postId, { clientRequestId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.plan.id).toBe(first.body.plan.id);
    expect(second.body.plan.source).toMatchObject({
      type: 'post',
      available: true,
      sourceId: postId.toString(),
    });

    expect(await getPlanThisCollection().countDocuments({ clientRequestId })).toBe(1);
    expect(await getDatabase().collection('messages').countDocuments({
      chatId,
      'planThis.planId': new ObjectId(first.body.plan.id),
    })).toBe(1);
  });

  it('rejects malformed create payloads with validation errors', async () => {
    const response = await request(app)
      .post('/plan-this/plans')
      .send({ title: '<img src=x onerror=alert(1)>' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid Plan This proposal.');
  });

  it('blocks non-participants from loading plans without leaking details', async () => {
    const chatId = await seedChat('group', { participants: [otherUserId, outsiderUserId], admins: [otherUserId] });
    const postId = await seedPost();
    const planId = new ObjectId();
    await getPlanThisCollection().insertOne({
      _id: planId,
      chatId,
      creatorUserId: otherUserId,
      source: { type: 'post', sourceId: postId, previewLabel: 'Secret source label' },
      state: 'voting',
      title: 'Secret plan',
      description: 'Secret plan details',
      checklist: [],
      participants: [{ userId: otherUserId, displayName: 'Other' }],
      votes: [],
      assignments: [],
      updateCount: 0,
      planVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app).get(`/plan-this/plans/${planId.toString()}`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Secret plan');
    expect(JSON.stringify(response.body)).not.toContain('Secret source label');
  });

  it('falls back safely when source content is deleted after plan creation', async () => {
    const chatId = await seedChat('group');
    const postId = await seedPost();
    const create = await createPlan(chatId, postId);
    expect(create.status).toBe(201);

    await getDatabase().collection('posts').updateOne({ _id: postId }, { $set: { deletedAt: new Date() } });
    const response = await request(app).get(`/plan-this/plans/${create.body.plan.id}`);

    expect(response.status).toBe(200);
    expect(response.body.plan.source).toEqual({ type: 'post', available: false });
    expect(JSON.stringify(response.body.plan.source)).not.toContain('brunch spot');
  });

  it('lets a participant change RSVP without duplicate current votes', async () => {
    const chatId = await seedChat('group');
    const postId = await seedPost();
    const create = await createPlan(chatId, postId);
    const planId = create.body.plan.id;

    const going = await request(app).post(`/plan-this/plans/${planId}/vote`).send({ status: 'going' });
    const maybe = await request(app).post(`/plan-this/plans/${planId}/vote`).send({ status: 'maybe' });

    expect(going.status).toBe(200);
    expect(maybe.status).toBe(200);
    expect(maybe.body.plan.myVote).toBe('maybe');
    expect(maybe.body.plan.votes.filter((vote: any) => vote.userId === mockUserId.toString())).toHaveLength(1);
  });

  it('finalize is idempotent so repeated submits do not break the final state', async () => {
    const chatId = await seedChat('group');
    const postId = await seedPost();
    const create = await createPlan(chatId, postId);
    const planId = create.body.plan.id;
    const payload = {
      createEvent: false,
      reminderEnabled: false,
      assignments: [{ title: 'Bring ID', assigneeUserId: mockUserId.toString() }],
    };

    const first = await request(app).post(`/plan-this/plans/${planId}/finalize`).send(payload);
    const second = await request(app).post(`/plan-this/plans/${planId}/finalize`).send(payload);

    expect(first.status).toBe(200);
    expect(first.body.plan.state).toBe('finalized');
    expect(second.status).toBe(200);
    expect(second.body.plan.state).toBe('finalized');
    expect(second.body.plan.id).toBe(planId);
    expect(await getDatabase().collection('chat_actions').countDocuments({
      'metadata.origin': 'plan_this',
      'metadata.planId': planId,
    })).toBe(1);
  });

  it('cancel is idempotent and withdraws active Plan-created actions', async () => {
    const chatId = await seedChat('group');
    const postId = await seedPost();
    const create = await createPlan(chatId, postId);
    const planId = create.body.plan.id;
    const finalized = await request(app).post(`/plan-this/plans/${planId}/finalize`).send({
      createEvent: false,
      reminderEnabled: false,
      assignments: [{ title: 'Confirm parking', assigneeUserId: mockUserId.toString() }],
    });
    expect(finalized.status).toBe(200);

    const firstCancel = await request(app).post(`/plan-this/plans/${planId}/cancel`);
    const secondCancel = await request(app).post(`/plan-this/plans/${planId}/cancel`);

    expect(firstCancel.status).toBe(200);
    expect(secondCancel.status).toBe(200);
    expect(secondCancel.body.plan.state).toBe('cancelled');
    expect(await getDatabase().collection('chat_actions').countDocuments({
      'metadata.origin': 'plan_this',
      'metadata.planId': planId,
      deletedAt: { $exists: false },
    })).toBe(0);
  });

  it('keeps one scoped chat card per backend plan when a chat has many plans', async () => {
    const chatId = await seedChat('group');
    const postId = await seedPost();

    for (let index = 0; index < 21; index += 1) {
      const response = await createPlan(chatId, postId, {
        title: `Move-in plan ${index + 1}`,
        clientRequestId: `many-plans-${index}`,
      });
      expect(response.status).toBe(201);
    }

    const plans = await getPlanThisCollection().find({ chatId }).toArray();
    const messages = await getDatabase().collection('messages').find({
      chatId,
      'planThis.planId': { $exists: true },
    }).toArray();

    expect(plans).toHaveLength(21);
    expect(messages).toHaveLength(21);
    expect(new Set(messages.map((message: any) => message.planThis.planId.toString())).size).toBe(21);
  });

  it('scopes Plan This cards to the destination chat across multiple chats', async () => {
    const chatAId = await seedChat('direct');
    const chatBId = await seedChat('group', { title: 'Weekend crew' });
    const postId = await seedPost();

    const chatAPlan = await createPlan(chatAId, postId, {
      title: 'Direct chat brunch',
      clientRequestId: 'chat-a-plan',
    });
    const chatBPlan = await createPlan(chatBId, postId, {
      title: 'Group chat brunch',
      clientRequestId: 'chat-b-plan',
    });

    expect(chatAPlan.status).toBe(201);
    expect(chatBPlan.status).toBe(201);

    expect(await getDatabase().collection('messages').countDocuments({
      chatId: chatAId,
      'planThis.planId': new ObjectId(chatAPlan.body.plan.id),
    })).toBe(1);
    expect(await getDatabase().collection('messages').countDocuments({
      chatId: chatAId,
      'planThis.planId': new ObjectId(chatBPlan.body.plan.id),
    })).toBe(0);
    expect(await getDatabase().collection('messages').countDocuments({
      chatId: chatBId,
      'planThis.planId': new ObjectId(chatBPlan.body.plan.id),
    })).toBe(1);
  });
});
