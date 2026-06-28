import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionReminderProcessor, type ActionReminderNotificationPayload } from './action-reminders';

const collections = new Map<string, FakeCollection<any>>();

vi.mock('./db', () => ({
  getDatabase: () => ({
    collection: <T>(name: string) => collections.get(name) as FakeCollection<T>,
  }),
}));

class FakeCursor<T extends Record<string, any>> {
  private limitValue: number | null = null;

  constructor(private readonly docs: T[]) {}

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  sort() {
    return this;
  }

  project() {
    return this;
  }

  async toArray() {
    return this.limitValue === null ? this.docs : this.docs.slice(0, this.limitValue);
  }
}

class FakeCollection<T extends Record<string, any>> {
  constructor(public docs: T[] = []) {}

  find(query: Record<string, any>) {
    return new FakeCursor(this.docs.filter((doc) => matches(doc, query)));
  }

  async findOne(query: Record<string, any>) {
    return this.docs.find((doc) => matches(doc, query)) ?? null;
  }

  async countDocuments(query: Record<string, any>) {
    return this.docs.filter((doc) => matches(doc, query)).length;
  }

  async findOneAndUpdate(query: Record<string, any>, update: Record<string, any>, options?: { upsert?: boolean }) {
    let doc = this.docs.find((item) => matches(item, query));
    if (!doc && options?.upsert) {
      doc = { _id: update.$setOnInsert?._id ?? new ObjectId(), ...(update.$setOnInsert || {}) } as T;
      this.docs.push(doc);
    }
    if (!doc) return null;
    Object.assign(doc, update.$setOnInsert ? Object.fromEntries(Object.entries(update.$setOnInsert).filter(([key]) => !(key in doc!))) : {});
    Object.assign(doc, update.$set || {});
    return doc;
  }

  async updateOne(query: Record<string, any>, update: Record<string, any>) {
    const doc = this.docs.find((item) => matches(item, query));
    if (doc) Object.assign(doc, update.$set || {});
    return { matchedCount: doc ? 1 : 0 };
  }

  async deleteOne(query: Record<string, any>) {
    const index = this.docs.findIndex((item) => matches(item, query));
    if (index >= 0) this.docs.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  }
}

function matches(doc: Record<string, any>, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((part: Record<string, any>) => matches(doc, part));
    if (key === '$and') return expected.every((part: Record<string, any>) => matches(doc, part));
    const actual = valueAt(doc, key);
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      if ('$exists' in expected) return expected.$exists ? actual !== undefined : actual === undefined;
      if ('$ne' in expected) return !isEqual(actual, expected.$ne);
      if ('$in' in expected) return expected.$in.some((item: unknown) => isEqual(actual, item));
      if ('$nin' in expected) return !expected.$nin.some((item: unknown) => isEqual(actual, item));
      if ('$gte' in expected) return actual >= expected.$gte;
      if ('$lte' in expected) return actual <= expected.$lte;
    }
    return isEqual(actual, expected);
  });
}

function valueAt(doc: Record<string, any>, path: string) {
  return path.split('.').reduce((value, key) => value?.[key], doc);
}

function isEqual(a: unknown, b: unknown) {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof ObjectId && typeof b === 'string') return a.toString() === b;
  if (b instanceof ObjectId && typeof a === 'string') return b.toString() === a;
  return a === b;
}

const ownerId = new ObjectId('6a3840876a63676274128b91');
const otherId = new ObjectId('6a32db6e57a468e4e3b49b9c');
const chatId = new ObjectId('6a3841c39b5154abb8d56970');

function action(overrides: Record<string, any> = {}) {
  const now = new Date('2026-06-26T12:00:00.000Z');
  return {
    _id: new ObjectId(),
    chatId,
    actionKey: 'task:test',
    type: 'task',
    title: 'Bring the cake',
    assignedTo: { userId: ownerId.toString(), name: 'Yugm' },
    createdBy: { userId: otherId.toString(), name: 'Venga' },
    dueDate: '2026-06-28',
    dueAt: new Date('2026-06-28T00:00:00.000Z'),
    status: 'open',
    visibility: 'chat',
    sourceMessageIds: [],
    generatedByUserId: ownerId,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

function seed(actionDoc = action()) {
  collections.set('chat_actions', new FakeCollection([actionDoc]));
  collections.set('chats', new FakeCollection([{
    _id: chatId,
    type: 'group',
    participants: [ownerId, otherId],
    admins: [ownerId],
    createdAt: new Date(),
    updatedAt: new Date(),
  }]));
  collections.set('userSettings', new FakeCollection([{ userId: ownerId, timezone: 'America/Los_Angeles' }]));
  collections.set('notificationPreferences', new FakeCollection([{ userId: ownerId }]));
  collections.set('action_reminder_deliveries', new FakeCollection([]));
  collections.set('processor_locks', new FakeCollection([]));
}

describe('ActionReminderProcessor', () => {
  beforeEach(() => {
    collections.clear();
  });

  it('sends due tomorrow once at 9 AM in the owner timezone', async () => {
    seed();
    const sent: ActionReminderNotificationPayload[] = [];
    const processor = new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-06-27T16:05:00.000Z')
    );

    await processor.runOnce();
    await processor.runOnce();

    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(ownerId.toString());
    expect(sent[0].title).toBe('Action due tomorrow');
    expect(sent[0].data.route).toMatch(/^\/actions\?actionId=/);
  });

  it('does not notify the creator or other group members', async () => {
    seed();
    const sent: ActionReminderNotificationPayload[] = [];
    await new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-06-27T16:05:00.000Z')
    ).runOnce();

    expect(sent.map((payload) => payload.userId)).toEqual([ownerId.toString()]);
    expect(sent.map((payload) => payload.userId)).not.toContain(otherId.toString());
  });

  it('skips completed actions and disabled reminder preferences', async () => {
    seed(action({ status: 'completed', completedAt: new Date() }));
    const sent: ActionReminderNotificationPayload[] = [];
    await new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-06-27T16:05:00.000Z')
    ).runOnce();
    expect(sent).toHaveLength(0);

    seed();
    collections.set('notificationPreferences', new FakeCollection([{ userId: ownerId, actionRemindersEnabled: false }]));
    await new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-06-27T16:05:00.000Z')
    ).runOnce();
    expect(sent).toHaveLength(0);
  });

  it('sends private direct reminders only to the personal owner', async () => {
    seed(action({ visibility: 'personal', personalOwnerUserId: ownerId }));
    collections.set('chats', new FakeCollection([{
      _id: chatId,
      type: 'direct',
      participants: [ownerId, otherId],
      createdAt: new Date(),
      updatedAt: new Date(),
    }]));
    const sent: ActionReminderNotificationPayload[] = [];

    await new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-06-27T16:05:00.000Z')
    ).runOnce();

    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(ownerId.toString());
    expect(sent[0].body).not.toMatch(/Venga|Direct chat/i);
  });

  it('waits another stale interval after action activity changes', async () => {
    seed(action({
      dueDate: undefined,
      dueAt: undefined,
      lastActivityAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const sent: ActionReminderNotificationPayload[] = [];

    await new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-06-30T16:05:00.000Z')
    ).runOnce();
    expect(sent).toHaveLength(0);

    await new ActionReminderProcessor(
      { send: async (payload) => { sent.push(payload); return { sent: 1 }; } },
      () => new Date('2026-07-01T16:05:00.000Z')
    ).runOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Action needs an update');
  });
});
