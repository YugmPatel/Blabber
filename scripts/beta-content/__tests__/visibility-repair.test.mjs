import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { applyPost, applyReel, ensureAccount, idFor } from '../db-writer.mjs';
import { buildEligibilityDiagnostic } from '../diagnose-eligibility.mjs';
import { repairSeedVisibility } from '../repair-visibility.mjs';

function sameId(a, b) {
  return a?.toString?.() === b?.toString?.();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matchesValue(actual, expected) {
  if (expected instanceof RegExp) return expected.test(actual);
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date) && !expected._bsontype) {
    if ('$in' in expected) {
      return expected.$in.some((candidate) => Array.isArray(actual) ? actual.some((item) => sameId(item, candidate) || item === candidate) : sameId(actual, candidate) || actual === candidate);
    }
    if ('$exists' in expected) return expected.$exists ? actual !== undefined : actual === undefined;
    if ('$ne' in expected) return !(sameId(actual, expected.$ne) || actual === expected.$ne);
  }
  return sameId(actual, expected) || actual === expected;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => matchesValue(doc[key], expected));
}

function applyUpdate(doc, update, inserting = false) {
  if (inserting && update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) delete doc[key];
  }
}

class FakeCollection {
  constructor(docs = []) {
    this.docs = docs;
  }

  find(filter = {}) {
    const rows = this.docs.filter((doc) => matches(doc, filter));
    return {
      project: () => this.find(filter),
      toArray: async () => rows,
    };
  }

  async findOne(filter = {}) {
    return this.docs.find((doc) => matches(doc, filter)) || null;
  }

  async updateOne(filter, update, options = {}) {
    let doc = this.docs.find((candidate) => matches(candidate, filter));
    const before = doc ? clone(doc) : null;
    if (!doc && options.upsert) {
      doc = { ...(filter._id ? { _id: filter._id } : {}) };
      this.docs.push(doc);
      applyUpdate(doc, update, true);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(doc, update, false);
    return { matchedCount: 1, modifiedCount: JSON.stringify(before) === JSON.stringify(clone(doc)) ? 0 : 1 };
  }

  async updateMany(filter, update) {
    let matchedCount = 0;
    let modifiedCount = 0;
    for (const doc of this.docs) {
      if (!matches(doc, filter)) continue;
      matchedCount += 1;
      const before = clone(doc);
      applyUpdate(doc, update, false);
      if (JSON.stringify(before) !== JSON.stringify(clone(doc))) modifiedCount += 1;
    }
    return { matchedCount, modifiedCount };
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((doc) => matches(doc, filter)).length;
  }
}

class FakeDb {
  constructor(seed = {}) {
    this.collections = new Map(Object.entries(seed).map(([name, docs]) => [name, new FakeCollection(docs)]));
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name);
  }
}

function seedRecord(seedKey, kind, mongoId, collection = `${kind}s`) {
  return { seedKey, kind, mongoId, collection, source: { source: 'generated' } };
}

describe('beta seed visibility restore', () => {
  it('apply after reset clears deactivatedAt/deletedAt on seed-owned users', async () => {
    const accountSpec = { seedKey: 'beta-user-blabber', handle: 'blabber', name: 'Blabber', bio: 'Official', topicSlugs: ['blabber_tips'] };
    const userId = idFor(ObjectId, accountSpec.seedKey);
    const db = new FakeDb({
      users: [{ _id: userId, deactivatedAt: new Date(), deletedAt: new Date(), profileVisibility: 'private', creatorDiscoveryEnabled: false }],
    });
    const restored = await ensureAccount(db, { ObjectId, accountSpec, now: new Date('2026-07-15T00:00:00Z') });
    expect(restored.deactivatedAt).toBeUndefined();
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.profileVisibility).toBe('public');
    expect(restored.creatorDiscoveryEnabled).toBe(true);
  });

  it('apply after reset clears deletedAt/hiddenAt/isHidden on seed-owned posts', async () => {
    const postSpec = { seedKey: 'beta-post-blabber-001', caption: 'Hello', topicSlug: 'blabber_tips', searchQuery: 'app' };
    const postId = idFor(ObjectId, postSpec.seedKey, 'post');
    const db = new FakeDb({
      posts: [{ _id: postId, discoverable: true, deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, importer: { source: 'generated' } }],
    });
    await applyPost(db, ObjectId, { author: { _id: new ObjectId() }, postSpec, picked: null, env: {}, ordinal: 0, now: new Date() });
    const restored = await db.collection('posts').findOne({ _id: postId });
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.hiddenAt).toBeUndefined();
    expect(restored.isHidden).toBeUndefined();
    expect(restored.visibility).toBe('public');
    expect(restored.discoverable).toBe(true);
  });

  it('apply after reset clears deletedAt/hiddenAt/isHidden on seed-owned reels', async () => {
    const reelSpec = { seedKey: 'beta-reel-blabber-001', caption: 'Hello', topicSlug: 'blabber_tips', searchQuery: 'app' };
    const reelId = idFor(ObjectId, reelSpec.seedKey, 'reel');
    const db = new FakeDb({
      reels: [{ _id: reelId, processingStatus: 'ready', reelDiscoverable: true, deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, importer: { source: 'generated' } }],
    });
    await applyReel(db, ObjectId, { author: { _id: new ObjectId() }, reelSpec, picked: null, env: {}, ordinal: 0, now: new Date(), processReels: async () => {} });
    const restored = await db.collection('reels').findOne({ _id: reelId });
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.hiddenAt).toBeUndefined();
    expect(restored.isHidden).toBeUndefined();
    expect(restored.visibility).toBe('public');
    expect(restored.reelDiscoverable).toBe(true);
    expect(restored.publishState).toBe('published');
    expect(restored.processingStatus).toBe('ready');
  });

  it('repair mode only touches seed-owned docs and leaves non-seed docs alone', async () => {
    const seedUserId = new ObjectId();
    const seedPostId = new ObjectId();
    const seedReelId = new ObjectId();
    const otherUserId = new ObjectId();
    const db = new FakeDb({
      beta_content_seed_records: [
        seedRecord('u', 'user', seedUserId, 'users'),
        seedRecord('p', 'post', seedPostId, 'posts'),
        seedRecord('r', 'reel', seedReelId, 'reels'),
      ],
      users: [
        { _id: seedUserId, deactivatedAt: new Date(), deletedAt: new Date(), profileVisibility: 'private', creatorDiscoveryEnabled: false },
        { _id: otherUserId, deactivatedAt: new Date(), deletedAt: new Date(), profileVisibility: 'private', creatorDiscoveryEnabled: false },
      ],
      posts: [
        { _id: seedPostId, deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, visibility: 'followers', discoverable: false },
        { _id: new ObjectId(), deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, visibility: 'followers', discoverable: false },
      ],
      reels: [
        { _id: seedReelId, deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, visibility: 'followers', reelDiscoverable: false, publishState: 'deleted', processingStatus: 'failed' },
        { _id: new ObjectId(), deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, visibility: 'followers', reelDiscoverable: false, publishState: 'deleted', processingStatus: 'failed' },
      ],
    });

    const result = await repairSeedVisibility(db);
    expect(result.matched).toEqual({ users: 1, posts: 1, reels: 1 });
    expect(result.remaining.tombstones).toMatchObject({
      deactivatedSeededUsers: 0,
      deletedSeededUsers: 0,
      deletedSeededPosts: 0,
      hiddenSeededPosts: 0,
      deletedSeededReels: 0,
      hiddenSeededReels: 0,
    });
    expect((await db.collection('users').findOne({ _id: otherUserId })).deactivatedAt).toBeTruthy();
    expect((await db.collection('posts').find({ isHidden: true }).toArray())).toHaveLength(1);
    expect((await db.collection('reels').find({ isHidden: true }).toArray())).toHaveLength(1);
  });

  it('diagnostic reports tombstones before repair and eligibility succeeds after repair', async () => {
    const userId = new ObjectId();
    const postId = new ObjectId();
    const reelId = new ObjectId();
    const postMediaId = new ObjectId();
    const reelMediaId = new ObjectId();
    const db = new FakeDb({
      beta_content_seed_records: [
        seedRecord('u', 'user', userId, 'users'),
        seedRecord('p', 'post', postId, 'posts'),
        seedRecord('r', 'reel', reelId, 'reels'),
      ],
      users: [{ _id: userId, deactivatedAt: new Date(), deletedAt: new Date(), emailVerified: true, profileHandle: 'blabber', profileVisibility: 'public', creatorDiscoveryEnabled: true, creatorTopicIds: ['blabber_tips'] }],
      posts: [{ _id: postId, authorUserId: userId, deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, visibility: 'public', discoverable: true, discoveryTopicIds: ['blabber_tips'], mediaIds: [postMediaId] }],
      reels: [{ _id: reelId, authorUserId: userId, sourceMediaId: reelMediaId, deletedAt: new Date(), hiddenAt: new Date(), isHidden: true, visibility: 'public', reelDiscoverable: true, publishState: 'published', processingStatus: 'ready', reelTopicIds: ['blabber_tips'], fallbackPath: '/tmp/f.mp4', posterPath: '/tmp/p.jpg', hlsSegments: [{ token: 'seg', path: '/tmp/s.ts' }] }],
      media: [
        { _id: postMediaId, userId, status: 'approved', fileType: 'image/jpeg' },
        { _id: reelMediaId, userId, status: 'approved', purpose: 'reel_source' },
      ],
    });

    const before = await buildEligibilityDiagnostic(db, { dbName: 'test' });
    expect(before.tombstoneReasons).toMatchObject({
      deactivatedSeededUsers: 1,
      deletedSeededUsers: 1,
      deletedSeededPosts: 1,
      hiddenSeededPosts: 1,
      deletedSeededReels: 1,
      hiddenSeededReels: 1,
    });
    expect(before.eligibleForColdStart).toMatchObject({ discoverCreators: 0, feedFeaturedPosts: 0, reelsBrowse: 0 });

    await repairSeedVisibility(db);
    const after = await buildEligibilityDiagnostic(db, { dbName: 'test' });
    expect(after.tombstoneReasons).toMatchObject({
      deactivatedSeededUsers: 0,
      deletedSeededUsers: 0,
      deletedSeededPosts: 0,
      hiddenSeededPosts: 0,
      deletedSeededReels: 0,
      hiddenSeededReels: 0,
    });
    expect(after.eligibleForColdStart).toMatchObject({
      discoverCreators: 1,
      feedFeaturedPosts: 1,
      discoverPosts: 1,
      reelsBrowse: 1,
      reelsForYouFallback: 1,
    });
  });
});
