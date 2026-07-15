#!/usr/bin/env node
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { mongoDbName, mongoUri } from './config.mjs';
import { BETA_TOPICS } from './topics.mjs';

dotenv.config();

const topicIds = BETA_TOPICS.map((topic) => topic.slug);
const reelTopicIds = new Set([
  'technology', 'artificial_intelligence', 'software_engineering', 'startups', 'business', 'finance', 'education', 'careers',
  'design', 'gaming', 'sports', 'fitness', 'health', 'food', 'travel', 'photography', 'music', 'film', 'books', 'science',
  'parenting', 'pets', 'home', 'fashion', 'comedy',
  'movies_tv', 'home_lifestyle',
  ...topicIds,
]);

const activeUserQuery = {
  deletedAt: { $exists: false },
  deactivatedAt: { $exists: false },
  emailVerified: true,
  profileHandle: { $exists: true },
  profileVisibility: 'public',
  creatorDiscoveryEnabled: true,
};

async function approvedPostMedia(db, post) {
  if (!Array.isArray(post.mediaIds) || post.mediaIds.length === 0) return true;
  const approved = await db.collection('media').countDocuments({
    _id: { $in: post.mediaIds },
    userId: post.authorUserId,
    status: 'approved',
    fileType: /^image\//,
  });
  return approved === post.mediaIds.length;
}

async function approvedReelMedia(db, reel) {
  if (!reel.fallbackPath || !reel.posterPath || !Array.isArray(reel.hlsSegments) || reel.hlsSegments.length === 0) return false;
  const media = await db.collection('media').findOne({
    _id: reel.sourceMediaId,
    userId: reel.authorUserId,
    status: 'approved',
    purpose: 'reel_source',
  });
  return Boolean(media);
}

async function main() {
  const client = new MongoClient(mongoUri());
  await client.connect();
  try {
    const db = client.db(mongoDbName());
    const eligibleCreators = await db.collection('users').find({
      ...activeUserQuery,
      creatorTopicIds: { $in: topicIds },
    }).project({ _id: 1 }).toArray();
    const eligibleCreatorIds = new Set(eligibleCreators.map((user) => user._id.toString()));

    const postCandidates = await db.collection('posts').find({
      discoverable: true,
      visibility: 'public',
      deletedAt: { $exists: false },
      authorUserId: { $in: eligibleCreators.map((user) => user._id) },
      discoveryTopicIds: { $in: topicIds },
    }).toArray();
    let feedDiscoverEligiblePosts = 0;
    let postMediaRejected = 0;
    for (const post of postCandidates) {
      if (!eligibleCreatorIds.has(post.authorUserId.toString())) continue;
      if (!Array.isArray(post.discoveryTopicIds) || post.discoveryTopicIds.length < 1 || post.discoveryTopicIds.length > 3) continue;
      if (await approvedPostMedia(db, post)) feedDiscoverEligiblePosts += 1;
      else postMediaRejected += 1;
    }

    const reelCandidates = await db.collection('reels').find({
      reelDiscoverable: true,
      publishState: 'published',
      processingStatus: 'ready',
      visibility: 'public',
      deletedAt: { $exists: false },
      moderationRemovedAt: { $exists: false },
      authorUserId: { $in: eligibleCreators.map((user) => user._id) },
    }).toArray();
    let browseEligibleReels = 0;
    let reelTopicRejected = 0;
    let reelMediaRejected = 0;
    for (const reel of reelCandidates) {
      const validTopics = Array.isArray(reel.reelTopicIds)
        ? reel.reelTopicIds.filter((topicId) => reelTopicIds.has(topicId))
        : [];
      if (validTopics.length < 1 || validTopics.length > 3) {
        reelTopicRejected += 1;
        continue;
      }
      if (await approvedReelMedia(db, reel)) browseEligibleReels += 1;
      else reelMediaRejected += 1;
    }

    const seedRecords = await db.collection('beta_content_seed_records').aggregate([
      { $group: { _id: '$kind', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();

    console.log(JSON.stringify({
      database: mongoDbName(),
      topicsConfiguredForDiscover: topicIds.length,
      betaSeedRecordsByKind: Object.fromEntries(seedRecords.map((row) => [row._id, row.count])),
      eligibleForColdStart: {
        discoverCreators: eligibleCreators.length,
        feedFeaturedPosts: feedDiscoverEligiblePosts,
        discoverPosts: feedDiscoverEligiblePosts,
        reelsBrowse: browseEligibleReels,
        reelsForYouFallback: browseEligibleReels,
      },
      rejectedByEligibilityProbe: {
        postMedia: postMediaRejected,
        reelTopics: reelTopicRejected,
        reelMediaOrDerivatives: reelMediaRejected,
      },
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
