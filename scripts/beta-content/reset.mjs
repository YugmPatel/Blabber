// --reset implementation. Only ever called after seed-beta-content.mjs has
// already verified --confirm-reset-beta-seed-content was passed — this
// module itself does not re-check that flag, by design (it's a pure "do the
// reset" step, the confirmation gate lives in the CLI entrypoint).
//
// Deliberately conservative: posts/reels are soft-hidden (deletedAt set,
// same as every other delete path in this app — see services/users/src/
// routes/posts.ts and services/media/src/routes/reels.ts) rather than hard
// deleted, and demo accounts are deactivated rather than removed, so a
// --reset can never destroy data a real (non-seed) user might have
// interacted with in a way that's unrecoverable. Reactions/comments/follows
// tied to seed content are hard-deleted since they're pure demo interaction
// data with no independent value once their target is hidden.

export async function resetBetaContent(db) {
  const records = await db.collection('beta_content_seed_records').find({}).toArray();
  const now = new Date();

  const idsByKind = (kind) => records.filter((record) => record.kind === kind).map((record) => record.mongoId);
  const postIds = idsByKind('post');
  const reelIds = idsByKind('reel');
  const userIds = idsByKind('user');

  const [postsHidden, reelsHidden] = await Promise.all([
    db.collection('posts').updateMany({ _id: { $in: postIds } }, { $set: { deletedAt: now, discoverable: false, updatedAt: now } }),
    db.collection('reels').updateMany({ _id: { $in: reelIds } }, { $set: { deletedAt: now, reelDiscoverable: false, publishState: 'deleted', updatedAt: now } }),
  ]);

  const [reactionsDeleted, commentsDeleted, reelReactionsDeleted, reelCommentsDeleted, followsDeleted] = await Promise.all([
    db.collection('post_reactions').deleteMany({ postId: { $in: postIds } }),
    db.collection('post_comments').deleteMany({ postId: { $in: postIds } }),
    db.collection('reel_reactions').deleteMany({ reelId: { $in: reelIds } }),
    db.collection('reel_comments').deleteMany({ reelId: { $in: reelIds } }),
    db.collection('profile_relationships').deleteMany({ $or: [{ followerUserId: { $in: userIds } }, { targetUserId: { $in: userIds } }] }),
  ]);

  const usersDeactivated = await db.collection('users').updateMany(
    { _id: { $in: userIds } },
    { $set: { deactivatedAt: now, profileVisibility: 'private', creatorDiscoveryEnabled: false, updatedAt: now } }
  );

  await db.collection('beta_content_seed_records').deleteMany({});

  return {
    postsHidden: postsHidden.modifiedCount,
    reelsHidden: reelsHidden.modifiedCount,
    usersDeactivated: usersDeactivated.modifiedCount,
    reactionsDeleted: reactionsDeleted.deletedCount + reelReactionsDeleted.deletedCount,
    commentsDeleted: commentsDeleted.deletedCount + reelCommentsDeleted.deletedCount,
    followsDeleted: followsDeleted.deletedCount,
    trackingRecordsCleared: records.length,
  };
}
