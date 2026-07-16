import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import app from '../app';
import { connectToDatabase, closeDatabase, getDatabase } from '../db';
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

async function enableVeyra() {
  const response = await request(app).patch('/veyra/settings').send({ enabled: true });
  expect(response.status).toBe(200);
  return response.body.settings;
}

async function grantScope(type: 'general' | 'my_actions' | 'chat' | 'community', targetId?: string) {
  const response = await request(app).post('/veyra/scopes').send({ type, targetId });
  expect(response.status).toBe(200);
  return response.body.settings;
}

async function seedChatWithUser(title = 'Design Crew'): Promise<ObjectId> {
  const otherUserId = new ObjectId();
  await seedChatUsers([otherUserId]);
  const chatId = new ObjectId();
  await getDatabase().collection('chats').insertOne({
    _id: chatId,
    type: 'group',
    title,
    participants: [mockUserId, otherUserId],
    admins: [mockUserId],
  } as any);
  return chatId;
}

async function seedMessage(chatId: ObjectId, overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: new ObjectId(),
    chatId,
    senderId: new ObjectId(),
    body: '',
    createdAt: new Date(),
    ...overrides,
  };
  await getDatabase().collection('messages').insertOne(doc as any);
  return doc;
}

describe('POST /veyra/ask', () => {
  beforeEach(async () => {
    await connectToDatabase();
    const db = getDatabase();
    await db.collection('veyra_settings').deleteMany({});
    await db.collection('veyra_audit').deleteMany({});
    await db.collection('chats').deleteMany({});
    await db.collection('users').deleteMany({});
    await db.collection('chat_actions').deleteMany({});
    await db.collection('chat_decisions').deleteMany({});
    await db.collection('plan_this_plans').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('messages').createIndex({ body: 'text', 'media.fileName': 'text' }).catch(() => undefined);
    await seedChatUsers([mockUserId]);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('rejects requests when Veyra is disabled with the exact required message', async () => {
    const response = await request(app).post('/veyra/ask').send({ prompt: 'Hi Veyra' });
    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Turn on Veyra in AI Privacy to begin.');
  });

  describe('general conversation (no scope required)', () => {
    it('answers a greeting with zero approved scopes', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Hi Veyra' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('greeting');
      expect(response.body.scope).toBeNull();
      expect(typeof response.body.answer).toBe('string');
      expect(response.body.answer.length).toBeGreaterThan(0);
    });

    it('answers "How are you?" as a greeting without a scope', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'How are you?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('greeting');
    });

    it('answers "What can you help with?" as general help without a scope', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'What can you help with?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_help');
      expect(response.body.scope).toBeNull();
    });

    it('answers navigation help without a scope', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Where can I find my chats?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('navigation_help');
      expect(response.body.scope).toBeNull();
    });

    it('records only safe category/success metadata in the audit log, never raw prompt/answer text', async () => {
      await enableVeyra();
      await request(app).post('/veyra/ask').send({ prompt: 'Hi Veyra' });
      const entries = await getDatabase().collection('veyra_audit').find({ userId: mockUserId }).toArray();
      expect(entries).toHaveLength(1);
      const [entry] = entries;
      expect(entry.scopeType).toBe('general');
      expect(entry.intentCategory).toBe('greeting');
      expect(entry.succeeded).toBe(true);
      expect(JSON.stringify(entry)).not.toContain('Hi Veyra');
    });
  });

  describe('scoped Blabber questions', () => {
    it('returns the specific privacy-management state when no scope is approved', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'What did my group decide?' });
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('To answer that, Veyra needs access to an approved space.');
      expect(response.body.code).toBe('scope_required');
    });

    it('answers a decision recap once the chat scope is approved', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser();
      const settings = await grantScope('chat', chatId.toString());
      const scopeId = settings.scopes[0].id;
      const response = await request(app).post('/veyra/ask').send({ prompt: 'What did my group decide?', scopeId });
      expect(response.status).toBe(200);
      expect(response.body.scope.type).toBe('chat');
    });

    it('does not leak plan status across chats when only a chat scope (not my_actions) is approved', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser();
      await grantScope('chat', chatId.toString());
      // A Plan This item in a completely different chat the user also belongs to.
      const otherChatId = await seedChatWithUser();
      await getDatabase().collection('plan_this_plans').insertOne({
        _id: new ObjectId(),
        chatId: otherChatId,
        creatorUserId: mockUserId,
        source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
        state: 'voting',
        title: 'Secret plan',
        description: 'x',
        checklist: [],
        participants: [{ userId: mockUserId }],
        votes: [],
        assignments: [],
        updateCount: 0,
        planVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'Do I need to vote on anything?' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('scope_required');
    });

    it('answers plan status once the my_actions scope is approved', async () => {
      await enableVeyra();
      await grantScope('my_actions');
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Do I need to vote on anything?' });
      expect(response.status).toBe(200);
      expect(response.body.scope.type).toBe('my_actions');
    });
  });

  describe('retrieval', () => {
    it('classifies "send me a photo from X chat" as retrieval, not an action or generic summary', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Yugm');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { media: { type: 'image', url: 'https://internal.example/raw-key.jpg' }, senderId: mockUserId });

      const response = await request(app).post('/veyra/ask').send({ prompt: "send me a photo from Yugm's chat" });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_photos');
      expect(response.body.actionDeferred).toBeFalsy();
      expect(response.body.resultType).toBe('attachment');
      expect(response.body.results).toHaveLength(1);
    });

    it('rejects a retrieval request with no approved scope with privacy guidance, not a generic error', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Show me photos from Family' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('scope_required');
      expect(response.body.message).toBe('To search that, Veyra needs access to an approved space.');
    });

    it('never returns attachments from a chat the user has not approved as a Veyra scope, even if they are a member', async () => {
      await enableVeyra();
      const approvedChatId = await seedChatWithUser('Yugm');
      await grantScope('chat', approvedChatId.toString());
      const unapprovedChatId = await seedChatWithUser('Yugm Secret');
      await seedMessage(unapprovedChatId, { media: { type: 'image', url: 'x' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'show me photos from Yugm' });
      expect(response.status).toBe(200);
      // Both chat labels contain "Yugm" — ambiguous rather than silently picking one, and
      // in no case does it return the unapproved chat's data directly.
      const chatIds = (response.body.results || []).map((card: any) => card.chatId);
      expect(chatIds).not.toContain(unapprovedChatId.toString());
    });

    it('does not leak messages/attachments from an unrelated chat when only one chat is approved', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      const otherChatId = await seedChatWithUser('Other Group');
      await seedMessage(otherChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'secret.pdf' } });
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'family-trip.pdf' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'List all PDFs in Family' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_documents');
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('family-trip.pdf');
    });

    it('distinguishes PDFs from other document types', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'trip.pdf' } });
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/msword', fileName: 'itinerary.docx' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'List all PDFs in Family' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('trip.pdf');
    });

    it('retrieves videos from an approved space', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Yugm');
      await grantScope('chat', chatId.toString());
      const message = await seedMessage(chatId, {
        media: { type: 'video', mimeType: 'video/mp4', fileName: 'demo-clip.mp4' },
        senderId: mockUserId,
      });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any video from yugm' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_videos');
      expect(response.body.resultType).toBe('attachment');
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('demo-clip.mp4');
      expect(response.body.results[0].deepLink).toEqual({ kind: 'chat_message', chatId: chatId.toString(), messageId: message._id.toString() });
    });

    it('returns only authorized links with safe deep links, never raw storage/provider URLs', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { body: 'check this out https://example.com/trip-plan' });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'What links were shared in this chat?', scopeId: (await getDatabase().collection('veyra_settings').findOne({ userId: mockUserId }))!.scopes[0].id });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_links');
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].deepLink).toEqual({ kind: 'chat_message', chatId: chatId.toString(), messageId: expect.any(String) });
    });

    it('finds a matching Plan This proposal for "where did we plan the trip" style questions', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      await getDatabase().collection('plan_this_plans').insertOne({
        _id: new ObjectId(),
        chatId,
        creatorUserId: mockUserId,
        source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
        state: 'voting',
        title: 'Hiking Trip',
        description: 'Weekend hiking trip plan',
        checklist: [],
        participants: [{ userId: mockUserId }],
        votes: [],
        assignments: [],
        updateCount: 0,
        planVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'Where did we plan the hiking trip?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_plans');
      expect(response.body.resultType).toBe('plan');
      expect(response.body.results[0].title).toBe('Hiking Trip');
    });

    it('treats "find any plan with Yugm" as plan retrieval, not plan status', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Yugm');
      await grantScope('chat', chatId.toString());
      await getDatabase().collection('plan_this_plans').insertOne({
        _id: new ObjectId(),
        chatId,
        creatorUserId: mockUserId,
        source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
        state: 'voting',
        title: 'Demo Trip',
        description: 'A plan with Yugm for the demo trip',
        checklist: [],
        participants: [{ userId: mockUserId }],
        votes: [],
        assignments: [],
        updateCount: 0,
        planVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any plan with yugm' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_plans');
      expect(response.body.resultType).toBe('plan');
      expect(response.body.results[0].title).toBe('Demo Trip');
    });

    it('treats "show my plans" as retrieval across approved spaces', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      await getDatabase().collection('plan_this_plans').insertOne({
        _id: new ObjectId(),
        chatId,
        creatorUserId: mockUserId,
        source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
        state: 'finalized',
        title: 'Apartment Planning',
        checklist: [],
        participants: [{ userId: mockUserId }],
        votes: [],
        assignments: [],
        updateCount: 0,
        planVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'show my plans' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_plans');
      expect(response.body.results[0].title).toBe('Apartment Planning');
    });

    it('asks a clarifying question instead of guessing when a chat name matches more than one approved scope', async () => {
      await enableVeyra();
      const chatA = await seedChatWithUser('Yugm Work');
      const chatB = await seedChatWithUser('Yugm Personal');
      await grantScope('chat', chatA.toString());
      await grantScope('chat', chatB.toString());

      const response = await request(app).post('/veyra/ask').send({ prompt: 'show me photos from Yugm' });
      expect(response.status).toBe(200);
      expect(response.body.ambiguous).toBe(true);
      expect(response.body.candidates).toHaveLength(2);
      expect(response.body.results).toHaveLength(0);
    });

    it('does not perform a side effect for action-class language; it returns a confirmation-ready proposal only', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { media: { type: 'image', url: 'x' } });
      await seedMessage(chatId, { media: { type: 'image', url: 'y' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'Send this photo to Family' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('action_request');
      expect(response.body.actionDeferred).toBe(true);
      expect(response.body.answer).toMatch(/choose one, then confirm where to send it/i);
      // No message was actually created/forwarded as a side effect of asking.
      const messageCount = await getDatabase().collection('messages').countDocuments({ chatId, senderId: mockUserId });
      expect(messageCount).toBe(0);
    });

    it('reports no results truthfully rather than inventing an answer', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      const response = await request(app).post('/veyra/ask').send({ prompt: 'show me photos from Family' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(0);
      expect(response.body.answer).toBe('No matching results found in your approved spaces.');
    });
  });

  describe('conversation context, target grounding, and safe fallback', () => {
    it('answers an identity question locally instead of a chat summary, even with an approved scope selected', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      const settings = await grantScope('chat', chatId.toString());
      const response = await request(app)
        .post('/veyra/ask')
        .send({ prompt: 'What is your name?', scopeId: settings.scopes[0].id });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('identity');
      expect(response.body.scope).toBeNull();
      expect(response.body.answer).toBe("I'm Veyra, your Blabber AI companion.");
    });

    it('answers a capability question without searching any approved chat', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      const response = await request(app).post('/veyra/ask').send({ prompt: 'What can you do?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_help');
      expect(response.body.scope).toBeNull();
      expect(response.body.results).toHaveLength(0);
      expect(response.body.answer).toMatch(/messages|links|pdf|photos|plans|tasks/i);
    });

    it('routes truly unclear input to a safe general response, never a chat summary', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Family');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { body: 'this is a private message body that must never leak' });
      const response = await request(app).post('/veyra/ask').send({ prompt: 'zzz blorp fizzbuzz' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('unclear');
      expect(response.body.scope).toBeNull();
      expect(response.body.answer).not.toContain('private message body');
      expect(JSON.stringify(response.body)).not.toContain('private message body');
    });

    it('lets an explicitly named target override a manually-selected scope, never answering from the wrong chat', async () => {
      await enableVeyra();
      const wrongChat = await seedChatWithUser('Direct chat with Yugm P');
      const rightChat = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', wrongChat.toString());
      await grantScope('chat', rightChat.toString());
      await seedMessage(rightChat, { media: { type: 'image', fileName: 'sandbox.jpg' } });

      const response = await request(app)
        .post('/veyra/ask')
        .send({ prompt: 'send me a photo from AI QA Sandbox', scopeId: settings.scopes[0].id });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.scope.label).toBe('AI QA Sandbox');
    });

    it('resolves a chat name despite spacing/casing differences from voice recognition', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('AI QA Sandbox');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { media: { type: 'image', fileName: 'sandbox.jpg' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'show me photos from AIQA sandbox' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.scope.label).toBe('AI QA Sandbox');
    });

    it('does not leak raw storage URLs in retrieval results', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Yugm');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { media: { type: 'image', url: 'https://internal.example/raw-storage-key.jpg', fileName: 'trip.jpg' } });
      const response = await request(app).post('/veyra/ask').send({ prompt: "send me a photo from Yugm's chat" });
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('raw-storage-key');
    });

    describe('follow-up context (who started it / PDFs from that group / tasks for this)', () => {
      async function seedPlanWithTask(chatId: ObjectId) {
        const actionId = new ObjectId();
        const planId = new ObjectId();
        await getDatabase().collection('chat_actions').insertOne({
          _id: actionId,
          chatId,
          actionKey: 'task-1',
          type: 'task',
          title: 'Book the campsite',
          status: 'open',
          sourceMessageIds: [],
          generatedByUserId: mockUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        await getDatabase().collection('plan_this_plans').insertOne({
          _id: planId,
          chatId,
          creatorUserId: mockUserId,
          source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
          state: 'voting',
          title: 'Santa Cruz Trip',
          description: 'Weekend trip',
          checklist: [],
          participants: [{ userId: mockUserId }],
          votes: [],
          assignments: [
            {
              id: 'assignment-1',
              title: 'Book the campsite',
              status: 'accepted',
              assigneeUserId: mockUserId,
              actionId,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          updateCount: 0,
          planVersion: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        return planId;
      }

      it('answers "Who started it?" using the grounded plan from a prior turn, not a guess', async () => {
        await enableVeyra();
        const chatId = await seedChatWithUser('AI QA Sandbox');
        const settings = await grantScope('chat', chatId.toString());
        const planId = await seedPlanWithTask(chatId);

        const response = await request(app).post('/veyra/ask').send({
          prompt: 'Who started it?',
          context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id },
        });
        expect(response.status).toBe(200);
        expect(response.body.intent).toBe('plan_creator');
        expect(response.body.results[0].title).toBe('Santa Cruz Trip');
      });

      it('asks a short clarification for "Who started it?" when there is no grounded plan yet', async () => {
        await enableVeyra();
        const chatId = await seedChatWithUser('AI QA Sandbox');
        await grantScope('chat', chatId.toString());
        const response = await request(app).post('/veyra/ask').send({ prompt: 'Who started it?' });
        expect(response.status).toBe(200);
        expect(response.body.intent).toBe('plan_creator');
        expect(response.body.answer).toBe('Which plan would you like to know about?');
      });

      it('answers "Show PDFs from that group" using the grounded space, with no chat name in the prompt', async () => {
        await enableVeyra();
        const chatId = await seedChatWithUser('AI QA Sandbox');
        const settings = await grantScope('chat', chatId.toString());
        await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });

        const response = await request(app).post('/veyra/ask').send({
          prompt: 'Show PDFs from that group',
          context: { activeSpaceId: settings.scopes[0].id, activeSpaceName: 'AI QA Sandbox' },
        });
        expect(response.status).toBe(200);
        expect(response.body.intent).toBe('find_documents');
        expect(response.body.results).toHaveLength(1);
        expect(response.body.results[0].title).toBe('itinerary.pdf');
      });

      it('answers "What tasks do I have for this?" grounded to the active plan', async () => {
        await enableVeyra();
        const chatId = await seedChatWithUser('AI QA Sandbox');
        const settings = await grantScope('chat', chatId.toString());
        const planId = await seedPlanWithTask(chatId);

        const response = await request(app).post('/veyra/ask').send({
          prompt: 'What tasks do I have for this?',
          context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id },
        });
        expect(response.status).toBe(200);
        expect(response.body.intent).toBe('action_status');
        expect(response.body.results).toHaveLength(1);
        expect(response.body.results[0].title).toBe('Book the campsite');
      });

      it('invalidates a grounded plan/space once its scope is revoked, rather than guessing another chat', async () => {
        await enableVeyra();
        const chatId = await seedChatWithUser('AI QA Sandbox');
        const settings = await grantScope('chat', chatId.toString());
        const planId = await seedPlanWithTask(chatId);
        const grantedScopeId = settings.scopes[0].id;

        await request(app).delete(`/veyra/scopes/${encodeURIComponent(grantedScopeId)}`);

        const response = await request(app).post('/veyra/ask').send({
          prompt: 'Who started it?',
          context: { activePlanId: planId.toString(), activeSpaceId: grantedScopeId },
        });
        expect(response.status).toBe(200);
        expect(response.body.answer).toBe("I couldn't find an authorized match in your approved Veyra spaces.");
        expect(response.body.results).toHaveLength(0);
      });
    });
  });

  describe('plan-scoped context grounding, plan-title lookup, and capability intents (v2)', () => {
    async function seedPlanWithHyphenatedTitleAndTasks(chatId: ObjectId, creatorId: ObjectId) {
      const actionId = new ObjectId();
      const helloActionId = new ObjectId();
      const planId = new ObjectId();
      await getDatabase().collection('chat_actions').insertOne({
        _id: actionId,
        chatId,
        actionKey: 'task-1',
        type: 'task',
        title: 'Book the campsite',
        status: 'open',
        sourceMessageIds: [],
        generatedByUserId: creatorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      // An unrelated chat action in the SAME chat that must never surface for
      // a "what tasks do I have for THIS PLAN" ask.
      await getDatabase().collection('chat_actions').insertOne({
        _id: helloActionId,
        chatId,
        actionKey: 'task-2',
        type: 'task',
        title: 'Hello',
        status: 'open',
        assignedTo: { userId: mockUserId.toString() },
        sourceMessageIds: [],
        generatedByUserId: creatorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      await getDatabase().collection('plan_this_plans').insertOne({
        _id: planId,
        chatId,
        creatorUserId: creatorId,
        source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
        state: 'voting',
        title: 'Santa Cruz Trip ORBIT-719',
        description: 'Weekend trip',
        checklist: [],
        participants: [{ userId: mockUserId }, { userId: creatorId }],
        votes: [],
        assignments: [
          {
            id: 'a1',
            title: 'Book the campsite',
            status: 'accepted',
            assigneeUserId: mockUserId,
            actionId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        updateCount: 0,
        planVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      return { planId, actionId, helloActionId };
    }

    async function seedSandboxWithCreator() {
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = new ObjectId();
      await getDatabase().collection('chats').insertOne({
        _id: chatId,
        type: 'group',
        title: 'AI QA Sandbox',
        participants: [mockUserId, creatorId],
        admins: [creatorId],
      } as any);
      return { chatId, creatorId };
    }

    it('finds a plan whose title has punctuation/stopwords that would break one literal contiguous regex', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      await grantScope('chat', chatId.toString());
      await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'Where did we plan Santa Cruz Trip ORBIT-719?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_plans');
      expect(response.body.results[0].title).toBe('Santa Cruz Trip ORBIT-719');
    });

    it('"Who started it?" resolves the creator from prior context without the user repeating the plan title', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      const settings = await grantScope('chat', chatId.toString());
      const { planId } = await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Who started it?',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('plan_creator');
      expect(response.body.answer).not.toMatch(/which plan/i);
      expect(response.body.answer).toContain('Santa Cruz Trip ORBIT-719');
      expect(response.body.results[0].senderName).toBe('User 1');
    });

    it('"Show PDFs from that group" resolves the previous plan\'s source space with no chat name repeated', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      const settings = await grantScope('chat', chatId.toString());
      const { planId } = await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show PDFs from that group',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_documents');
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('itinerary.pdf');
      expect(response.body.scope.label).toBe('AI QA Sandbox');
    });

    it('a failed follow-up (stale/revoked context) does not erase the context echoed back for later requests', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      const settings = await grantScope('chat', chatId.toString());
      const { planId } = await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);
      const grantedScopeId = settings.scopes[0].id;
      await request(app).delete(`/veyra/scopes/${encodeURIComponent(grantedScopeId)}`);

      const context = { activePlanId: planId.toString(), activeSpaceId: grantedScopeId, activePlanTitle: 'Santa Cruz Trip ORBIT-719' };
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Who started it?', context });
      expect(response.status).toBe(200);
      expect(response.body.answer).toBe("I couldn't find an authorized match in your approved Veyra spaces.");
      // The echoed context is preserved (not wiped) even though this particular
      // request was correctly refused — a later, unrelated request can still
      // try again, and will independently re-authorize regardless.
      expect(response.body.context).toEqual(context);
    });

    it('a bare reply matching an approved plan title is treated as a plan lookup, not a generic capability response', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      await grantScope('chat', chatId.toString());
      await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'Santa Cruz Trip ORBIT-719' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_plans');
      expect(response.body.results[0].title).toBe('Santa Cruz Trip ORBIT-719');
      expect(response.body.context.activePlanId).toBeDefined();
    });

    it('"What tasks do I have for this?" returns only the plan-linked task assigned to the user, excluding unrelated actions like "Hello"', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      const settings = await grantScope('chat', chatId.toString());
      const { planId } = await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'What tasks do I have for this?',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id },
      });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('Book the campsite');
      expect(response.body.results.some((card: any) => card.title === 'Hello')).toBe(false);
      expect(response.body.answer).toContain('Santa Cruz Trip ORBIT-719');
      expect(response.body.answer).toContain('AI QA Sandbox');
    });

    it('denies retrieval from a revoked space even though the old grounded context is still sent', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      const settings = await grantScope('chat', chatId.toString());
      const { planId } = await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);
      const grantedScopeId = settings.scopes[0].id;
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });
      await request(app).delete(`/veyra/scopes/${encodeURIComponent(grantedScopeId)}`);

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show PDFs from that group',
        context: { activePlanId: planId.toString(), activeSpaceId: grantedScopeId, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('scope_required');
    });

    it('"What is an approved Veyra space?" gets a clear explanatory answer', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'What is an approved Veyra space?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_help');
      expect(response.body.answer.toLowerCase()).toContain('explicitly selected');
    });

    it('"Which spaces do you have access to right now?" lists only the user\'s currently approved spaces, no IDs', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('AI QA Sandbox');
      await grantScope('chat', chatId.toString());
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Which spaces do you have access to right now?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('capability_spaces');
      expect(response.body.answer).toContain('AI QA Sandbox');
      expect(response.body.answer).not.toMatch(/[0-9a-f]{24}/);
    });

    it('says no spaces are approved yet and offers to manage AI privacy when none are granted', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'What chats can you look in?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('capability_spaces');
      expect(response.body.suggestManageAiPrivacy).toBe(true);
    });

    it('never leaks raw IDs, storage URLs, or private content in plan-creator/capability responses', async () => {
      await enableVeyra();
      const { chatId, creatorId } = await seedSandboxWithCreator();
      const settings = await grantScope('chat', chatId.toString());
      const { planId } = await seedPlanWithHyphenatedTitleAndTasks(chatId, creatorId);
      await seedMessage(chatId, { body: 'a private message that must never leak', media: { type: 'image', url: 'https://internal.example/secret-key.jpg' } });

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Who started it?',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id },
      });
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('secret-key');
      expect(serialized).not.toContain('a private message that must never leak');
    });
  });

  describe('contextual "that group" / "this chat" / "from there" retrieval grounding', () => {
    async function seedGroundedPlan(chatId: ObjectId, creatorId: ObjectId, title = 'Santa Cruz Trip ORBIT-719') {
      const planId = new ObjectId();
      await getDatabase().collection('plan_this_plans').insertOne({
        _id: planId,
        chatId,
        creatorUserId: creatorId,
        source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'x' },
        state: 'voting',
        title,
        description: 'Weekend trip',
        checklist: [],
        participants: [{ userId: mockUserId }, { userId: creatorId }],
        votes: [],
        assignments: [],
        updateCount: 0,
        planVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      return planId;
    }

    it('1. plan lookup -> "Who started it?" -> "Show PDFs from that group" returns only PDFs from AI QA Sandbox', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      await grantScope('chat', chatId.toString());
      await seedGroundedPlan(chatId, creatorId);
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });

      const turn1 = await request(app).post('/veyra/ask').send({ prompt: 'Where did we plan Santa Cruz Trip ORBIT-719?' });
      expect(turn1.body.intent).toBe('find_plans');

      const turn2 = await request(app).post('/veyra/ask').send({ prompt: 'Who started it?', context: turn1.body.context });
      expect(turn2.body.intent).toBe('plan_creator');

      const turn3 = await request(app).post('/veyra/ask').send({ prompt: 'Show PDFs from that group', context: turn2.body.context });
      expect(turn3.status).toBe(200);
      expect(turn3.body.intent).toBe('find_documents');
      expect(turn3.body.scope.label).toBe('AI QA Sandbox');
      expect(turn3.body.results).toHaveLength(1);
      expect(turn3.body.results[0].title).toBe('itinerary.pdf');
      expect(turn3.body.answer).toBe('I found 1 PDF in AI QA Sandbox related to the current plan context.');
    });

    it('2. the literal words "that group" never trigger explicit chat-name matching against an unapproved chat', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', chatId.toString());
      const planId = await seedGroundedPlan(chatId, creatorId);
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });
      // An unapproved chat literally named "That Group" — if "that group" were
      // ever treated as an explicit name, this would wrongly be a candidate.
      await seedChatWithUser('That Group');

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show PDFs from that group',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(200);
      expect(response.body.ambiguous).toBeFalsy();
      expect(response.body.scope.label).toBe('AI QA Sandbox');
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('itinerary.pdf');
    });

    it('3. "Show photos from that group" resolves to the same active source space', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', chatId.toString());
      const planId = await seedGroundedPlan(chatId, creatorId);
      await seedMessage(chatId, { media: { type: 'image', fileName: 'sandbox.jpg' } });

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show photos from that group',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_photos');
      expect(response.body.scope.label).toBe('AI QA Sandbox');
      expect(response.body.results[0].title).toBe('sandbox.jpg');
    });

    it('4. "List links from that group" resolves to the same active source space', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', chatId.toString());
      const planId = await seedGroundedPlan(chatId, creatorId);
      await seedMessage(chatId, { body: 'campsite info https://example.com/campsite' });

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'List links from that group',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('find_links');
      expect(response.body.scope.label).toBe('AI QA Sandbox');
      expect(response.body.results[0].title).toBe('https://example.com/campsite');
    });

    it('5. an explicit "Show PDFs from Family" overrides AI QA Sandbox context when Family is approved', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const sandboxChatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', sandboxChatId.toString());
      const planId = await seedGroundedPlan(sandboxChatId, creatorId);
      await seedMessage(sandboxChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'sandbox.pdf' } });
      const familyChatId = await seedChatWithUser('Family');
      await grantScope('chat', familyChatId.toString());
      await seedMessage(familyChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'family-recipe.pdf' } });

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show PDFs from Family',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(200);
      expect(response.body.scope.label).toBe('Family');
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('family-recipe.pdf');
    });

    it('6. an unapproved explicit space is denied and never falls back to the grounded AI QA Sandbox context', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', chatId.toString());
      const planId = await seedGroundedPlan(chatId, creatorId);
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show PDFs from Nonexistent Chat Xyz',
        context: { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('scope_required');
    });

    it('7. revoking AI QA Sandbox denies "Show PDFs from that group" even with preserved old context', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', chatId.toString());
      const planId = await seedGroundedPlan(chatId, creatorId);
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });
      const grantedScopeId = settings.scopes[0].id;
      await request(app).delete(`/veyra/scopes/${encodeURIComponent(grantedScopeId)}`);

      const response = await request(app).post('/veyra/ask').send({
        prompt: 'Show PDFs from that group',
        context: { activePlanId: planId.toString(), activeSpaceId: grantedScopeId, activePlanTitle: 'Santa Cruz Trip ORBIT-719' },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('scope_required');
    });

    it('8. a failed PDF lookup (none exist) does not clear the current plan/source-space context', async () => {
      await enableVeyra();
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      const chatId = await seedChatWithUser('AI QA Sandbox');
      const settings = await grantScope('chat', chatId.toString());
      const planId = await seedGroundedPlan(chatId, creatorId);
      // No PDFs seeded in this chat at all.

      const context = { activePlanId: planId.toString(), activeSpaceId: settings.scopes[0].id, activePlanTitle: 'Santa Cruz Trip ORBIT-719' };
      const response = await request(app).post('/veyra/ask').send({ prompt: 'Show PDFs from that group', context });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(0);
      expect(response.body.answer).toBe('No matching results found in your approved spaces.');
      expect(response.body.context).toEqual(context);
    });
  });

  describe('access modes', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
    });

    it('defaults a brand-new user to approved_spaces', async () => {
      const response = await request(app).get('/veyra/settings');
      expect(response.status).toBe(200);
      expect(response.body.settings.accessMode).toBe('approved_spaces');
    });

    it('approved_spaces mode only searches spaces the user explicitly granted, even if they belong to other chats', async () => {
      await enableVeyra();
      const approvedChatId = await seedChatWithUser('Approved Crew');
      const unapprovedChatId = await seedChatWithUser('Unapproved Crew');
      await grantScope('chat', approvedChatId.toString());
      await seedMessage(approvedChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'approved.pdf' } });
      await seedMessage(unapprovedChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'unapproved.pdf' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('approved.pdf');
    });

    it('full_access mode aggregates a broad/unnamed retrieval question across every one of the user\'s chats, without an individual grant and without asking which space', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const chatOne = await seedChatWithUser('Trip Planning');
      const chatTwo = await seedChatWithUser('Apartment Hunt');
      await seedMessage(chatOne, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'lease.pdf' } });
      await seedMessage(chatTwo, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });

      // Neither chat was individually approved, and the prompt names no
      // specific chat — with zero grants this would be scope_required under
      // approved_spaces. Full Access must not ask the user to pick a space
      // for a broad question like this; it searches every accessible chat
      // and merges the results instead.
      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf' });
      expect(response.status).toBe(200);
      expect(response.body.ambiguous).toBeFalsy();
      const titles = response.body.results.map((result: any) => result.title).sort();
      expect(titles).toEqual(['itinerary.pdf', 'lease.pdf']);
    });

    it('full_access mode retrieves from a specific chat once it is named, with no prior grant needed', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      await seedChatWithUser('Trip Planning');
      const apartmentChat = await seedChatWithUser('Apartment Hunt');
      await seedMessage(apartmentChat, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'lease.pdf' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find pdf in Apartment Hunt' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('lease.pdf');
    });

    it('full_access "find any pdf with yugm" searches across all accessible spaces matching that name', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      await seedChatWithUser('Design Crew');
      const yugmChat = await seedChatWithUser('Yugm Trip');
      await seedMessage(yugmChat, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'lease.pdf' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf with yugm' });
      expect(response.status).toBe(200);
      expect(response.body.ambiguous).toBeFalsy();
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].title).toBe('lease.pdf');
    });

    it('full_access "show all my plans" searches every accessible chat\'s plans/events, not just one', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const chatOne = await seedChatWithUser('Trip Planning');
      const chatTwo = await seedChatWithUser('Apartment Hunt');
      const creatorId = new ObjectId();
      await seedChatUsers([creatorId]);
      await getDatabase().collection('plan_this_plans').insertMany([
        {
          _id: new ObjectId(),
          chatId: chatOne,
          creatorUserId: creatorId,
          source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'Trip' },
          state: 'proposed',
          title: 'Yosemite Weekend',
          description: '',
          checklist: [],
          participants: [{ userId: mockUserId }],
          votes: [],
          assignments: [],
          updateCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          chatId: chatTwo,
          creatorUserId: creatorId,
          source: { type: 'post', sourceId: new ObjectId(), previewLabel: 'Apartment' },
          state: 'proposed',
          title: 'Apartment Viewing',
          description: '',
          checklist: [],
          participants: [{ userId: mockUserId }],
          votes: [],
          assignments: [],
          updateCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'show all my plans' });
      expect(response.status).toBe(200);
      expect(response.body.ambiguous).toBeFalsy();
      const titles = response.body.results.map((result: any) => result.title).sort();
      expect(titles).toEqual(['Apartment Viewing', 'Yosemite Weekend']);
    });

    it('full_access "summarize today" aggregates across multiple chats/groups and does not ask which space', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const chatOne = await seedChatWithUser('Trip Planning');
      const chatTwo = await seedChatWithUser('Apartment Hunt');
      await seedMessage(chatOne, { body: 'Let us book the flights today', createdAt: new Date() });
      await seedMessage(chatTwo, { body: 'Signed the lease this morning', createdAt: new Date() });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'summarize today' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('daily_recap');
      expect(response.body.ambiguous).toBeFalsy();
      expect(response.body.candidates).toBeUndefined();
      expect(typeof response.body.answer).toBe('string');
      expect(response.body.answer.length).toBeGreaterThan(0);
    });

    it('full_access daily recap gives a clear no-results answer (not an approved-space warning) when nothing was found', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      await seedChatWithUser('Quiet Chat');

      const response = await request(app).post('/veyra/ask').send({ prompt: 'summarize today' });
      expect(response.status).toBe(200);
      expect(response.body.answer).toBe('No matching Blabber activity was found today.');
      expect(response.body.answer).not.toMatch(/approved space/i);
    });

    it('full_access generic question "what is Docker?" uses the OpenRouter general-assistant path, not retrieval', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OPENROUTER_MODEL = 'test-model';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Docker is a container platform.' } }] }),
      }));

      const response = await request(app).post('/veyra/ask').send({ prompt: 'what is Docker?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
      expect(response.body.answer).toBe('Docker is a container platform.');
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
    });

    it('"summarize this apartment planning conversation" is treated as a grounded Blabber question, never a generic assistant answer', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Apartment Planning');
      await grantScope('chat', chatId.toString());
      const response = await request(app).post('/veyra/ask').send({ prompt: 'summarize this apartment planning conversation' });
      expect(response.status).toBe(200);
      expect(response.body.intent).not.toBe('general_assistant');
    });

    it('approved_spaces mode never aggregates beyond explicitly approved spaces, even for a broad daily recap question', async () => {
      await enableVeyra();
      const approvedChat = await seedChatWithUser('Approved Crew');
      const unapprovedChat = await seedChatWithUser('Unapproved Crew');
      await grantScope('chat', approvedChat.toString());
      await seedMessage(approvedChat, { body: 'Approved chat activity today' });
      await seedMessage(unapprovedChat, { body: 'Unapproved chat activity today' });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'summarize today' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('daily_recap');
      const cardChatLabels = response.body.results.map((result: any) => result.chatLabel);
      expect(cardChatLabels.every((label: string) => label !== 'Unapproved Crew')).toBe(true);
    });

    it('full_access mode still never returns content from a chat the user is not a participant in', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const myChatId = await seedChatWithUser('My Chat');
      await seedMessage(myChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'mine.pdf' } });

      // A chat the mocked user is NOT a participant of.
      const strangerId = new ObjectId();
      const otherUserId = new ObjectId();
      await seedChatUsers([strangerId, otherUserId]);
      const foreignChatId = new ObjectId();
      await getDatabase().collection('chats').insertOne({
        _id: foreignChatId,
        type: 'group',
        title: 'Not Mine',
        participants: [strangerId, otherUserId],
        admins: [strangerId],
      } as any);
      await seedMessage(foreignChatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'not-mine.pdf' } });

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf' });
      expect(response.status).toBe(200);
      const titles = response.body.results.map((result: any) => result.title);
      expect(titles).toEqual(['mine.pdf']);
      expect(titles).not.toContain('not-mine.pdf');
    });

    it('full_access mode grants the implicit My Actions/plan-status permission without an explicit grant', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const response = await request(app).post('/veyra/ask').send({ prompt: 'what is still waiting for my vote' });
      expect(response.status).toBe(200);
      expect(response.body.scope).not.toBeNull();
      expect(response.body.scope.type).toBe('my_actions');
    });

    it('revoking full_access immediately narrows back to approved_spaces on the very next request (no stale broad access)', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const chatId = await seedChatWithUser('Never Approved');
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'secret.pdf' } });

      const whileFullAccess = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf' });
      expect(whileFullAccess.body.results).toHaveLength(1);

      await request(app).patch('/veyra/settings').send({ accessMode: 'approved_spaces' });
      const afterRevoke = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf' });
      expect(afterRevoke.status).toBe(403);
      expect(afterRevoke.body.code).toBe('scope_required');
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
    });

    it('full_access mode routes an unclassifiable query to OpenRouter instead of the old dead-end message', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OPENROUTER_MODEL = 'test-model';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Sure, happy to help with that.' } }] }),
      }));

      const response = await request(app).post('/veyra/ask').send({ prompt: 'zzz blorp fizzbuzz' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
      expect(response.body.answer).not.toContain("I'm not sure how to help");
      expect(response.body.answer).toBe('Sure, happy to help with that.');
    });

    it('approved_spaces mode keeps the original conservative "not sure how to help" response for the same unclassifiable query', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'zzz blorp fizzbuzz' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('unclear');
      expect(response.body.answer).toContain("I'm not sure how to help");
    });

    it('full_access empty-retrieval answer never mentions "approved spaces"', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      await seedChatWithUser('Only Chat');
      const response = await request(app).post('/veyra/ask').send({ prompt: 'find pdf in Only Chat' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(0);
      expect(response.body.answer).not.toMatch(/approved space/i);
      expect(response.body.answer).toContain("couldn't find any matching content");
    });

    it('approved_spaces empty-retrieval answer still references approved spaces (unchanged conservative behavior)', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Only Chat');
      await grantScope('chat', chatId.toString());
      const response = await request(app).post('/veyra/ask').send({ prompt: 'find pdf in Only Chat' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(0);
      expect(response.body.answer).toBe('No matching results found in your approved spaces.');
    });

    it('full_access general_help copy never mentions "approved"', async () => {
      await enableVeyra();
      await request(app).patch('/veyra/settings').send({ accessMode: 'full_access' });
      const response = await request(app).post('/veyra/ask').send({ prompt: 'what can you help with?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_help');
      expect(response.body.answer).not.toMatch(/approved/i);
    });
  });

  describe('general assistant questions', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
    });

    it('answers a general-knowledge question with zero approved scopes and no retrieval', async () => {
      await enableVeyra();
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OPENROUTER_MODEL = 'test-model';
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Docker packages an app with everything it needs to run.' } }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const response = await request(app).post('/veyra/ask').send({ prompt: 'explain Docker simply' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
      expect(response.body.scope).toBeNull();
      expect(response.body.answer).toBe('Docker packages an app with everything it needs to run.');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still works with zero approved spaces (general questions never require scope access)', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'write a professional follow-up email' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
    });

    it('falls back to a safe, non-crashing message when OpenRouter is not configured', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'help me draft a workout routine for beginners' });
      expect(response.status).toBe(200);
      expect(response.body.answer).toBe('Veyra could not reach the AI model right now. Please try again.');
    });

    it('falls back to a safe, non-crashing message when the OpenRouter call throws', async () => {
      await enableVeyra();
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OPENROUTER_MODEL = 'test-model';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      const response = await request(app).post('/veyra/ask').send({ prompt: 'give me ideas for my project' });
      expect(response.status).toBe(200);
      expect(response.body.answer).toBe('Veyra could not reach the AI model right now. Please try again.');
    });

    it('does not treat a Blabber-scoped summary request as a general assistant question', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Apartment Planning');
      await grantScope('chat', chatId.toString());
      const response = await request(app).post('/veyra/ask').send({ prompt: 'what did we decide about the apartment?' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('decision_recap');
    });

    it('answers "what is docker" as a general assistant question (the exact reported blocker)', async () => {
      await enableVeyra();
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OPENROUTER_MODEL = 'test-model';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Docker is a containerization platform.' } }] }),
      }));

      const response = await request(app).post('/veyra/ask').send({ prompt: 'what is docker' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
      expect(response.body.answer).toBe('Docker is a containerization platform.');
      expect(response.body.answer).not.toContain("I'm not sure how to help");
    });

    it('answers "help me draft a message" as a general writing-help request, not a Blabber message search', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'help me draft a message' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
    });

    it('answers "give me a resume bullet for this project" as a general writing-help request', async () => {
      await enableVeyra();
      const response = await request(app).post('/veyra/ask').send({ prompt: 'give me a resume bullet for this project' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('general_assistant');
    });

    it('does not hijack a Blabber vote/plan-status question even though it starts with "what is"', async () => {
      await enableVeyra();
      await grantScope('my_actions');
      const response = await request(app).post('/veyra/ask').send({ prompt: 'what is still waiting for my vote' });
      expect(response.status).toBe(200);
      expect(response.body.intent).toBe('plan_status');
    });
  });

  describe('OpenRouter retrieval synthesis fallback', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
    });

    it('uses the deterministic answer, not a crash, when OpenRouter fails during retrieval synthesis', async () => {
      await enableVeyra();
      const chatId = await seedChatWithUser('Trip Crew');
      await grantScope('chat', chatId.toString());
      await seedMessage(chatId, { media: { type: 'document', mimeType: 'application/pdf', fileName: 'itinerary.pdf' } });
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OPENROUTER_MODEL = 'test-model';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

      const response = await request(app).post('/veyra/ask').send({ prompt: 'find any pdf' });
      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(typeof response.body.answer).toBe('string');
      expect(response.body.answer.length).toBeGreaterThan(0);
    });
  });
});
