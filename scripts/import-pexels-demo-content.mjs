import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

const IMPORTER_NAME = 'pexels-demo-content';
const IMPORTER_VERSION = '2026-07-pexels-demo-v1';
const PHOTO_TARGET_PER_TOPIC = 5;
const VIDEO_TARGET_PER_TOPIC = 2;
const MAX_PHOTO_BYTES = 18 * 1024 * 1024;
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
const PHOTO_TOPICS = [
  ['coffee shop', ['food', 'business']],
  ['food plating', ['food', 'photography']],
  ['friends dinner', ['food', 'travel']],
  ['city walk', ['travel', 'photography']],
  ['travel landscape', ['travel', 'photography']],
  ['beach sunset', ['travel', 'photography']],
  ['mountain hiking', ['travel', 'fitness']],
  ['fitness workout', ['fitness', 'health']],
  ['running outdoors', ['fitness', 'sports']],
  ['yoga studio', ['fitness', 'health']],
  ['desk setup', ['technology', 'design']],
  ['software developer', ['software_engineering', 'technology']],
  ['creative workspace', ['design', 'business']],
  ['campus study', ['education', 'careers']],
  ['bookstore', ['books', 'education']],
  ['team collaboration', ['business', 'startups']],
];
const VIDEO_TOPICS = [
  ['coffee pouring', ['food']],
  ['city walking', ['travel']],
  ['mountain hiking', ['travel', 'fitness']],
  ['beach waves', ['travel']],
  ['fitness workout', ['fitness']],
  ['running outdoors', ['fitness', 'sports']],
  ['cooking food', ['food']],
  ['workspace typing', ['technology', 'software_engineering']],
  ['friends laughing', ['comedy']],
  ['nature trail', ['travel', 'photography']],
  ['sunset landscape', ['travel', 'photography']],
  ['street market', ['travel', 'food']],
];
const CREATORS = [
  ['Avery Chen', 'pexels_avery'],
  ['Mira Santos', 'pexels_mira'],
  ['Noah Patel', 'pexels_noah'],
  ['Iris Morgan', 'pexels_iris'],
  ['Eli Turner', 'pexels_eli'],
  ['Sofia Rivera', 'pexels_sofia'],
  ['Lena Brooks', 'pexels_lena'],
  ['Kai Wilson', 'pexels_kai'],
  ['Maya Reed', 'pexels_maya'],
  ['Owen Clark', 'pexels_owen'],
  ['Nina Shah', 'pexels_nina'],
  ['Theo Grant', 'pexels_theo'],
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.env.BLABBER_PEXELS_IMPORT_IN_CONTAINER !== '1') {
  dotenv.config({ quiet: true });
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY is required.');
  run('docker', ['compose', '-f', 'docker-compose.full.yml', 'cp', 'scripts/import-pexels-demo-content.mjs', 'media:/app/services/media/import-pexels-demo-content.mjs']);
  run('docker', ['compose', '-f', 'docker-compose.full.yml', 'exec', '-T', '-e', 'BLABBER_PEXELS_IMPORT_IN_CONTAINER=1', '-e', 'NODE_ENV=development', '-e', 'APP_ENV=development', '-e', 'PEXELS_API_KEY', 'media', 'node', '/app/services/media/import-pexels-demo-content.mjs'], {
    env: { ...process.env },
  });
  process.exit(0);
}

function assertDevelopmentOnly() {
  const prodValues = [process.env.NODE_ENV, process.env.APP_ENV, process.env.BLABBER_ENV].filter(Boolean).map((value) => String(value).toLowerCase());
  if (prodValues.some((value) => value === 'production' || value.includes('prod'))) {
    throw new Error('Refusing to import Pexels demo content in a production-like environment.');
  }
  if (!String(process.env.MONGO_DB_NAME || '').includes('full') && !String(process.env.MONGO_URI || '').includes('mongodb')) {
    throw new Error('Refusing to import Pexels demo content outside local development.');
  }
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY is required.');
}

assertDevelopmentOnly();

const { MongoClient, ObjectId } = await import('mongodb');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const mediaRoot = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
const mongo = new MongoClient(process.env.MONGO_URI || 'mongodb://mongodb:27017');
await mongo.connect();
const db = mongo.db(process.env.MONGO_DB_NAME || 'blabber_full');
const now = new Date();

function idFor(kind, value) {
  return new ObjectId(createHash('sha1').update(`${IMPORTER_NAME}:${kind}:${value}`).digest('hex').slice(0, 24));
}

function jwtBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function accessTokenFor(user) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    userId: user._id.toString(),
    username: user.username,
    email: user.email,
    iat: nowSeconds,
    exp: nowSeconds + 10 * 60,
  };
  const unsigned = `${jwtBase64Url({ alg: 'HS256', typ: 'JWT' })}.${jwtBase64Url(payload)}`;
  return `${unsigned}.${createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(unsigned).digest('base64url')}`;
}

function provenance(asset, assetType, topic) {
  return {
    name: IMPORTER_NAME,
    version: IMPORTER_VERSION,
    provider: 'pexels',
    providerAssetId: String(asset.id),
    providerCreatorName: String(asset.photographer || asset.user?.name || '').slice(0, 120) || 'Pexels creator',
    providerPageReference: String(asset.url || '').slice(0, 500),
    assetType,
    topic,
    importedAt: now,
    importerVersion: IMPORTER_VERSION,
    sourceUsageNotes: 'Development-only locally stored Pexels demo catalog; no hotlinking.',
  };
}

async function pexels(path, params) {
  const url = new URL(`https://api.pexels.com/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!response.ok) throw new Error(`pexels_${path.replace(/\W/g, '_')}_${response.status}`);
  return response.json();
}

async function downloadBuffer(url, maxBytes) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error('download_size_rejected');
  return bytes;
}

async function ensureCreators() {
  for (let i = 0; i < CREATORS.length; i += 1) {
    const [name, handle] = CREATORS[i];
    await db.collection('users').updateOne(
      { email: `pexels-catalog-${i + 1}@local.blabber.dev` },
      {
        $setOnInsert: {
          _id: idFor('user', handle),
          email: `pexels-catalog-${i + 1}@local.blabber.dev`,
          passwordHash: 'local-content-import-login-disabled',
          username: handle,
          createdAt: now,
        },
        $set: {
          name,
          emailVerified: true,
          profileHandle: handle,
          profileVisibility: 'public',
          creatorDiscoveryEnabled: true,
          creatorDiscoveryEnabledAt: new Date(now.getTime() - i * 60_000),
          creatorTopicIds: PHOTO_TOPICS[i % PHOTO_TOPICS.length][1],
          importer: { name: IMPORTER_NAME, version: IMPORTER_VERSION, importedAt: now },
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }
  return db.collection('users').find({ email: /^pexels-catalog-\d+@local\.blabber\.dev$/ }).sort({ email: 1 }).toArray();
}

async function hidePreviousPlaceholderCatalog() {
  const technicalContentPattern = /smoke|fixture|test creator|test post|fake reel|seed record|demo-social|practical note on|original motion study/i;
  const oldCreatorIds = CREATORS.map(([, handle]) => new ObjectId(createHash('sha1').update(`blabber-demo-social:user:${handle}`).digest('hex').slice(0, 24)));
  const [posts, reels] = await Promise.all([
    db.collection('posts').updateMany(
      {
        $or: [
          { authorUserId: { $in: oldCreatorIds }, body: technicalContentPattern },
          { _id: { $in: Array.from({ length: 60 }, (_, i) => new ObjectId(createHash('sha1').update(`blabber-demo-social:post:${i}`).digest('hex').slice(0, 24))) } },
        ],
      },
      { $set: { discoverable: false, discoverableUpdatedAt: now, updatedAt: now } }
    ),
    db.collection('reels').updateMany(
      {
        $or: [
          { authorUserId: { $in: oldCreatorIds }, caption: technicalContentPattern },
          { authorUserId: { $in: oldCreatorIds }, processingKey: technicalContentPattern },
          { _id: { $in: Array.from({ length: 24 }, (_, i) => new ObjectId(createHash('sha1').update(`blabber-demo-social:reel:${i}`).digest('hex').slice(0, 24))) } },
        ],
      },
      { $set: { reelDiscoverable: false, reelDiscoverableUpdatedAt: now, updatedAt: now } }
    ),
  ]);
  return { posts: posts.modifiedCount, reels: reels.modifiedCount };
}

async function approvePhoto({ author, asset, query, topicIds, ordinal }) {
  const mediaId = idFor('photo-media', `${asset.id}`);
  const postId = idFor('photo-post', `${asset.id}`);
  const existingPost = await db.collection('posts').findOne({ _id: postId, discoverable: true });
  if (existingPost) return 'existing';
  const sourceUrl = asset.src?.large2x || asset.src?.large || asset.src?.original;
  if (!sourceUrl) throw new Error('missing_photo_source');
  const image = await downloadBuffer(sourceUrl, MAX_PHOTO_BYTES);
  const localPath = join(mediaRoot, 'pexels-demo', 'photos', `${mediaId}.jpg`);
  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: new Date(now.getTime() - ordinal * 300_000) },
      $set: {
        userId: author._id,
        fileName: `photo-${ordinal + 1}.jpg`,
        originalFileName: `photo-${ordinal + 1}.jpg`,
        fileType: 'image/jpeg',
        fileSize: image.length,
        s3Key: `pexels-demo/photos/${mediaId}.jpg`,
        url: `/api/media/local/${mediaId}`,
        storage: 'local',
        localPath,
        status: 'pending',
        purpose: 'general',
        importer: provenance(asset, 'photo', query),
        updatedAt: now,
      },
      $unset: { approvedAt: '', uploadedAt: '', scanMode: '', scanResult: '', scanErrorCategory: '', rejectedAt: '', quarantinedAt: '' },
    },
    { upsert: true }
  );
  const response = await fetch(`http://localhost:${process.env.PORT || 3005}/local/${mediaId.toString()}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessTokenFor(author)}`, 'Content-Type': 'image/jpeg' },
    body: image,
  });
  if (!response.ok) throw new Error('photo_pipeline_rejected');
  const approved = await db.collection('media').findOne({ _id: mediaId, status: 'approved', fileType: /^image\//, uploadedAt: { $exists: true } });
  if (!approved) throw new Error('photo_not_approved');
  await db.collection('posts').updateOne(
    { _id: postId },
    {
      $setOnInsert: { _id: postId, createdAt: new Date(now.getTime() - ordinal * 300_000) },
      $set: {
        authorUserId: author._id,
        body: captionFor(query, ordinal),
        visibility: 'public',
        mediaIds: [mediaId],
        discoverable: true,
        discoveryTopicIds: topicIds.slice(0, 3),
        discoverableUpdatedAt: new Date(now.getTime() - ordinal * 300_000),
        commentCount: 0,
        reactionCounts: {},
        importer: provenance(asset, 'photo', query),
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  await db.collection('pexels_demo_imports').updateOne(
    { provider: 'pexels', providerAssetId: String(asset.id), assetType: 'photo' },
    { $set: { importer: provenance(asset, 'photo', query), mediaId, postId, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), createdAt: now } },
    { upsert: true }
  );
  return 'imported';
}

function captionFor(query, ordinal) {
  const variants = [
    `A quiet moment from ${query}.`,
    `Small details from a ${query} day.`,
    `Saved this view while exploring ${query}.`,
    `A fresh angle on ${query}.`,
    `Scenes worth keeping from ${query}.`,
  ];
  return variants[ordinal % variants.length];
}

function pickVideoFile(asset) {
  const files = Array.isArray(asset.video_files) ? asset.video_files : [];
  return files
    .filter((file) => String(file.file_type || '').toLowerCase() === 'video/mp4' && file.link)
    .filter((file) => Number(file.width || 0) <= 1920 && Number(file.height || 0) <= 1920)
    .filter((file) => Number(file.height || 0) >= Number(file.width || 0))
    .sort((a, b) => {
      const areaA = Number(a.width || 0) * Number(a.height || 0);
      const areaB = Number(b.width || 0) * Number(b.height || 0);
      return Math.abs(areaA - 720 * 1280) - Math.abs(areaB - 720 * 1280);
    })[0] || files.find((file) => String(file.file_type || '').toLowerCase() === 'video/mp4' && file.link);
}

async function approveVideo({ author, asset, query, topicIds, ordinal }) {
  const mediaId = idFor('video-media', `${asset.id}`);
  const reelId = idFor('video-reel', `${asset.id}`);
  const existingReel = await db.collection('reels').findOne({ _id: reelId, processingStatus: 'ready', reelDiscoverable: true });
  if (existingReel) return 'existing';
  if (Number(asset.duration || 0) > 30) throw new Error('video_duration_rejected');
  const file = pickVideoFile(asset);
  if (!file?.link) throw new Error('missing_video_source');
  const source = await downloadBuffer(file.link, MAX_VIDEO_BYTES);
  const sourcePath = join(mediaRoot, 'reel-sources', `${mediaId}.mp4`);
  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: new Date(now.getTime() - ordinal * 450_000) },
      $set: {
        userId: author._id,
        fileName: `short-video-${ordinal + 1}.mp4`,
        originalFileName: `short-video-${ordinal + 1}.mp4`,
        fileType: 'video/mp4',
        fileSize: source.length,
        s3Key: `pexels-demo/reels/${mediaId}.mp4`,
        url: '',
        storage: 'local',
        localPath: sourcePath,
        status: 'pending',
        purpose: 'reel_source',
        reelId,
        importer: provenance(asset, 'video', query),
        updatedAt: now,
      },
      $unset: { detectedFileType: '', scanMode: '', scanResult: '', scanErrorCategory: '', approvedAt: '', uploadedAt: '', rejectedAt: '' },
    },
    { upsert: true }
  );
  await db.collection('reels').updateOne(
    { _id: reelId },
    {
      $setOnInsert: { _id: reelId, createdAt: new Date(now.getTime() - ordinal * 450_000), schemaVersion: 1 },
      $set: {
        authorUserId: author._id,
        sourceMediaId: mediaId,
        processingStatus: 'upload_initiated',
        publishState: 'draft',
        caption: '',
        visibility: 'followers',
        topicIds: [],
        reelDiscoverable: false,
        reelTopicIds: topicIds.slice(0, 3),
        processingKey: `${IMPORTER_NAME}:${asset.id}`,
        importer: provenance(asset, 'video', query),
        updatedAt: now,
      },
      $unset: { fallbackPath: '', posterPath: '', hlsPlaylistPath: '', hlsSegments: '', deletedAt: '', moderationRemovedAt: '' },
    },
    { upsert: true }
  );
  const response = await fetch(`http://localhost:${process.env.PORT || 3005}/reels/uploads/${reelId.toString()}/source`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessTokenFor(author)}`, 'Content-Type': 'video/mp4' },
    body: source,
  });
  if (!response.ok) throw new Error('video_upload_rejected');
  await processReels();
  const ready = await db.collection('reels').findOne({ _id: reelId, processingStatus: 'ready', fallbackPath: { $exists: true }, posterPath: { $exists: true } });
  if (!ready) throw new Error('video_not_ready');
  await db.collection('reels').updateOne(
    { _id: reelId, processingStatus: 'ready' },
    {
      $set: {
        caption: `A short scene from ${query}.`,
        visibility: 'public',
        topicIds: topicIds.slice(0, 3),
        reelDiscoverable: true,
        reelTopicIds: topicIds.slice(0, 3),
        reelDiscoverableUpdatedAt: new Date(now.getTime() - ordinal * 450_000),
        reactionCounts: ready.reactionCounts || {},
        commentCount: ready.commentCount || 0,
        publishState: 'published',
        publishedAt: ready.publishedAt || new Date(now.getTime() - ordinal * 450_000),
        importer: provenance(asset, 'video', query),
        updatedAt: now,
      },
    }
  );
  await db.collection('pexels_demo_imports').updateOne(
    { provider: 'pexels', providerAssetId: String(asset.id), assetType: 'video' },
    { $set: { importer: provenance(asset, 'video', query), mediaId, reelId, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), createdAt: now } },
    { upsert: true }
  );
  return 'imported';
}

async function processReels() {
  const { connectToDatabase, closeDatabase } = require('/app/services/media/dist/db.js');
  const { processOnePendingReel } = require('/app/services/media/dist/reel-processing.js');
  await connectToDatabase();
  try {
    for (let i = 0; i < 3; i += 1) {
      const processed = await processOnePendingReel();
      if (!processed) break;
    }
  } finally {
    await closeDatabase();
  }
}

async function runImport() {
  const creators = await ensureCreators();
  const hiddenPlaceholders = await hidePreviousPlaceholderCatalog();
  const topicDistribution = {};
  const skips = {};
  let importedPhotos = 0;
  let importedVideos = 0;

  for (const [query, topicIds] of PHOTO_TOPICS) {
    const data = await pexels('v1/search', { query, orientation: 'landscape', per_page: 12, page: 1, locale: 'en-US' });
    let perTopic = 0;
    for (const asset of data.photos || []) {
      if (perTopic >= PHOTO_TARGET_PER_TOPIC) break;
      try {
        const ordinal = importedPhotos + perTopic;
        const result = await approvePhoto({ author: creators[ordinal % creators.length], asset, query, topicIds, ordinal });
        if (result === 'imported') importedPhotos += 1;
        perTopic += 1;
        topicDistribution[query] = (topicDistribution[query] || 0) + 1;
      } catch (error) {
        const key = error instanceof Error ? error.message : 'photo_skipped';
        skips[key] = (skips[key] || 0) + 1;
      }
    }
  }

  for (const [query, topicIds] of VIDEO_TOPICS) {
    const data = await pexels('videos/search', { query, orientation: 'portrait', per_page: 8, page: 1, locale: 'en-US' });
    let perTopic = 0;
    for (const asset of data.videos || []) {
      if (perTopic >= VIDEO_TARGET_PER_TOPIC) break;
      try {
        const ordinal = importedVideos + perTopic;
        const result = await approveVideo({ author: creators[ordinal % creators.length], asset, query, topicIds, ordinal });
        if (result === 'imported') importedVideos += 1;
        perTopic += 1;
        topicDistribution[query] = (topicDistribution[query] || 0) + 1;
      } catch (error) {
        const key = error instanceof Error ? error.message : 'video_skipped';
        skips[key] = (skips[key] || 0) + 1;
      }
    }
  }

  const [visiblePhotos, visibleVideos, approvedImportedPhotos, readyImportedVideos] = await Promise.all([
    db.collection('posts').countDocuments({ 'importer.name': IMPORTER_NAME, discoverable: true, visibility: 'public', deletedAt: { $exists: false } }),
    db.collection('reels').countDocuments({ 'importer.name': IMPORTER_NAME, reelDiscoverable: true, processingStatus: 'ready', publishState: 'published', visibility: 'public', deletedAt: { $exists: false } }),
    db.collection('media').countDocuments({ 'importer.name': IMPORTER_NAME, 'importer.assetType': 'photo', status: 'approved', fileType: /^image\// }),
    db.collection('media').countDocuments({ 'importer.name': IMPORTER_NAME, 'importer.assetType': 'video', status: 'approved', purpose: 'reel_source' }),
  ]);
  console.log(JSON.stringify({
    creators: creators.length,
    visiblePhotos,
    visibleVideos,
    approvedImportedPhotos,
    readyImportedVideos,
    importedThisRun: { photos: importedPhotos, videos: importedVideos },
    topicDistribution,
    hiddenPlaceholders,
    skippedByCategory: skips,
  }, null, 2));
}

try {
  await runImport();
} finally {
  await mongo.close();
}
