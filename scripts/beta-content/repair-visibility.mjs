function idString(value) {
  return value?.toString?.() || String(value);
}

function idsByKind(records, kind) {
  return records.filter((record) => record.kind === kind && record.mongoId).map((record) => record.mongoId);
}

export async function seedVisibilityRecords(db) {
  return db.collection('beta_content_seed_records').find({
    kind: { $in: ['user', 'post', 'reel'] },
  }).toArray();
}

export async function countSeedVisibilityTombstones(db, records = null) {
  const seedRecords = records || await seedVisibilityRecords(db);
  const userIds = idsByKind(seedRecords, 'user');
  const postIds = idsByKind(seedRecords, 'post');
  const reelIds = idsByKind(seedRecords, 'reel');

  const [users, posts, reels] = await Promise.all([
    userIds.length ? db.collection('users').find({ _id: { $in: userIds } }).toArray() : [],
    postIds.length ? db.collection('posts').find({ _id: { $in: postIds } }).toArray() : [],
    reelIds.length ? db.collection('reels').find({ _id: { $in: reelIds } }).toArray() : [],
  ]);

  const existingUserIds = new Set(users.map((doc) => idString(doc._id)));
  const existingPostIds = new Set(posts.map((doc) => idString(doc._id)));
  const existingReelIds = new Set(reels.map((doc) => idString(doc._id)));

  return {
    seedRecords: { users: userIds.length, posts: postIds.length, reels: reelIds.length },
    missingSeedDocs: {
      users: userIds.filter((id) => !existingUserIds.has(idString(id))).length,
      posts: postIds.filter((id) => !existingPostIds.has(idString(id))).length,
      reels: reelIds.filter((id) => !existingReelIds.has(idString(id))).length,
    },
    tombstones: {
      deactivatedSeededUsers: users.filter((doc) => doc.deactivatedAt).length,
      deletedSeededUsers: users.filter((doc) => doc.deletedAt).length,
      deletedSeededPosts: posts.filter((doc) => doc.deletedAt).length,
      hiddenSeededPosts: posts.filter((doc) => doc.hiddenAt || doc.isHidden).length,
      deletedSeededReels: reels.filter((doc) => doc.deletedAt).length,
      hiddenSeededReels: reels.filter((doc) => doc.hiddenAt || doc.isHidden).length,
    },
  };
}

export async function repairSeedVisibility(db, { now = new Date() } = {}) {
  const records = await seedVisibilityRecords(db);
  const userIds = idsByKind(records, 'user');
  const postIds = idsByKind(records, 'post');
  const reelIds = idsByKind(records, 'reel');

  const [users, posts, reels] = await Promise.all([
    userIds.length
      ? db.collection('users').updateMany(
          { _id: { $in: userIds } },
          {
            $set: { profileVisibility: 'public', creatorDiscoveryEnabled: true, updatedAt: now },
            $unset: { deactivatedAt: '', deletedAt: '' },
          }
        )
      : { matchedCount: 0, modifiedCount: 0 },
    postIds.length
      ? db.collection('posts').updateMany(
          { _id: { $in: postIds } },
          {
            $set: { visibility: 'public', discoverable: true, updatedAt: now },
            $unset: { deletedAt: '', hiddenAt: '', isHidden: '' },
          }
        )
      : { matchedCount: 0, modifiedCount: 0 },
    reelIds.length
      ? db.collection('reels').updateMany(
          { _id: { $in: reelIds } },
          {
            $set: {
              visibility: 'public',
              reelDiscoverable: true,
              publishState: 'published',
              processingStatus: 'ready',
              updatedAt: now,
            },
            $unset: { deletedAt: '', hiddenAt: '', isHidden: '' },
          }
        )
      : { matchedCount: 0, modifiedCount: 0 },
  ]);

  const remaining = await countSeedVisibilityTombstones(db, records);
  return {
    matched: {
      users: users.matchedCount || 0,
      posts: posts.matchedCount || 0,
      reels: reels.matchedCount || 0,
    },
    modified: {
      users: users.modifiedCount || 0,
      posts: posts.modifiedCount || 0,
      reels: reels.modifiedCount || 0,
    },
    remaining,
  };
}
