#!/usr/bin/env node
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mongoDbName, mongoUri } from './config.mjs';
import { BETA_TOPICS } from './topics.mjs';
import { countSeedVisibilityTombstones } from './repair-visibility.mjs';

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

function idsByKind(records, kind) {
  return records.filter((record) => record.kind === kind && record.mongoId).map((record) => record.mongoId);
}

export async function buildEligibilityDiagnostic(db, { dbName = mongoDbName() } = {}) {
  const seedRecords = await db.collection('beta_content_seed_records').find({
    kind: { $in: ['user', 'post', 'reel'] },
  }).toArray();
  const seedUserIds = idsByKind(seedRecords, 'user');
  const seedPostIds = idsByKind(seedRecords, 'post');
  const seedReelIds = idsByKind(seedRecords, 'reel');
  const tombstoneReport = await countSeedVisibilityTombstones(db, seedRecords);

  const eligibleCreators = seedUserIds.length
    ? await db.collection('users').find({
        _id: { $in: seedUserIds },
        ...activeUserQuery,
        creatorTopicIds: { $in: topicIds },
      }).project({ _id: 1 }).toArray()
    : [];
  const eligibleCreatorIds = new Set(eligibleCreators.map((user) => user._id.toString()));

  const postCandidates = seedPostIds.length
    ? await db.collection('posts').find({
        _id: { $in: seedPostIds },
        discoverable: true,
        visibility: 'public',
        deletedAt: { $exists: false },
        authorUserId: { $in: eligibleCreators.map((user) => user._id) },
        discoveryTopicIds: { $in: topicIds },
      }).toArray()
    : [];
  let feedDiscoverEligiblePosts = 0;
  let postMediaRejected = 0;
  for (const post of postCandidates) {
    if (!eligibleCreatorIds.has(post.authorUserId.toString())) continue;
    if (post.hiddenAt || post.isHidden) continue;
    if (!Array.isArray(post.discoveryTopicIds) || post.discoveryTopicIds.length < 1 || post.discoveryTopicIds.length > 3) continue;
    if (await approvedPostMedia(db, post)) feedDiscoverEligiblePosts += 1;
    else postMediaRejected += 1;
  }

  const reelCandidates = seedReelIds.length
    ? await db.collection('reels').find({
        _id: { $in: seedReelIds },
        reelDiscoverable: true,
        publishState: 'published',
        processingStatus: 'ready',
        visibility: 'public',
        deletedAt: { $exists: false },
        moderationRemovedAt: { $exists: false },
        authorUserId: { $in: eligibleCreators.map((user) => user._id) },
      }).toArray()
    : [];
  let browseEligibleReels = 0;
  let reelTopicRejected = 0;
  let reelMediaRejected = 0;
  for (const reel of reelCandidates) {
    if (reel.hiddenAt || reel.isHidden) continue;
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

  const byKind = {};
  for (const record of seedRecords) byKind[record.kind] = (byKind[record.kind] || 0) + 1;
  const sourceMix = {};
  const allSeedRecords = await db.collection('beta_content_seed_records').find({}).toArray();
  for (const record of allSeedRecords) {
    const source = record.source?.source || 'unknown';
    sourceMix[source] = (sourceMix[source] || 0) + 1;
  }

  return {
    database: dbName,
    topicsConfiguredForDiscover: topicIds.length,
    betaSeedRecordsByKind: byKind,
    betaSeedSourceMix: sourceMix,
    seedVisibilityRecords: tombstoneReport.seedRecords,
    eligibleForColdStart: {
      discoverCreators: eligibleCreators.length,
      feedFeaturedPosts: feedDiscoverEligiblePosts,
      discoverPosts: feedDiscoverEligiblePosts,
      reelsBrowse: browseEligibleReels,
      reelsForYouFallback: browseEligibleReels,
    },
    tombstoneReasons: tombstoneReport.tombstones,
    missingSeedDocs: tombstoneReport.missingSeedDocs,
    rejectedByEligibilityProbe: {
      postMedia: postMediaRejected,
      reelTopics: reelTopicRejected,
      reelMediaOrDerivatives: reelMediaRejected,
    },
  };
}

async function main() {
  dotenv.config({ quiet: true });
  const client = new MongoClient(mongoUri());
  await client.connect();
  try {
    const db = client.db(mongoDbName());
    console.log(JSON.stringify(await buildEligibilityDiagnostic(db), null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
  });
}
