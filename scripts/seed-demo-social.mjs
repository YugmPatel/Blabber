import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TOPICS = [
  'technology',
  'artificial_intelligence',
  'software_engineering',
  'startups',
  'business',
  'finance',
  'education',
  'careers',
  'design',
  'fitness',
  'travel',
  'food',
];

const NAMES = [
  ['Avery Chen', 'avery_fieldnotes'],
  ['Mira Santos', 'mira_makes'],
  ['Noah Patel', 'noah_builds'],
  ['Iris Morgan', 'iris_studio'],
  ['Eli Turner', 'eli_notes'],
  ['Sofia Rivera', 'sofia_sketches'],
  ['Lena Brooks', 'lena_daily'],
  ['Kai Wilson', 'kai_workshop'],
  ['Maya Reed', 'maya_routes'],
  ['Owen Clark', 'owen_lab'],
  ['Nina Shah', 'nina_plans'],
  ['Theo Grant', 'theo_guides'],
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  return result;
}

if (process.env.BLABBER_DEMO_SEED_IN_CONTAINER !== '1') {
  run('docker', ['compose', '-f', 'docker-compose.full.yml', 'cp', 'scripts/seed-demo-social.mjs', 'media:/app/services/media/seed-demo-social.mjs']);
  run('docker', ['compose', '-f', 'docker-compose.full.yml', 'exec', '-T', '-e', 'BLABBER_DEMO_SEED_IN_CONTAINER=1', 'media', 'node', '/app/services/media/seed-demo-social.mjs']);
  process.exit(0);
}

if (process.env.NODE_ENV === 'production' && !String(process.env.MONGO_DB_NAME || '').includes('full')) {
  throw new Error('Refusing to seed demo social content outside local development.');
}

const { MongoClient, ObjectId } = await import('mongodb');
const mediaRoot = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
const mongo = new MongoClient(process.env.MONGO_URI || 'mongodb://mongodb:27017');
await mongo.connect();
const db = mongo.db(process.env.MONGO_DB_NAME || 'blabber_full');

function idFor(kind, value) {
  return new ObjectId(createHash('sha1').update(`blabber-demo-social:${kind}:${value}`).digest('hex').slice(0, 24));
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

function runFfmpegForImage(path, topic, index) {
  const hue = (index * 37) % 360;
  const color = ((hue * 97531) % 0xffffff).toString(16).padStart(6, '0');
  runQuiet('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=0x${color}:s=1200x900:d=1`,
    '-frames:v', '1',
    '-vf', [
      `drawbox=x=${80 + (index % 5) * 28}:y=${90 + (index % 4) * 36}:w=520:h=420:color=white@0.18:t=fill`,
      `drawbox=x=${520 + (index % 3) * 64}:y=${250 + (index % 5) * 30}:w=420:h=280:color=black@0.16:t=fill`,
      'drawbox=x=80:y=650:w=1040:h=150:color=white@0.20:t=fill',
    ].join(','),
    path,
  ]);
}

async function approveSeedImage({ author, mediaId, index, topic }) {
  const imagePath = join(mediaRoot, 'demo-social', 'images', `${mediaId}.png`);
  runFfmpegForImage(imagePath, topic, index);
  const image = readFileSync(imagePath);
  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: now },
      $set: {
        userId: author._id,
        fileName: `field-note-${index + 1}.png`,
        originalFileName: `field-note-${index + 1}.png`,
        fileType: 'image/png',
        detectedFileType: 'image/png',
        fileSize: image.length,
        s3Key: `demo-social/posts/${mediaId}.png`,
        url: `/api/media/local/${mediaId}`,
        storage: 'local',
        localPath: imagePath,
        status: 'pending',
        purpose: 'general',
        updatedAt: now,
      },
      $unset: {
        approvedAt: '',
        uploadedAt: '',
        scanMode: '',
        scanResult: '',
        scanErrorCategory: '',
        rejectedAt: '',
        quarantinedAt: '',
      },
    },
    { upsert: true }
  );
  const response = await fetch(`http://localhost:${process.env.PORT || 3005}/local/${mediaId.toString()}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessTokenFor(author)}`,
      'Content-Type': 'image/png',
    },
    body: image,
  });
  if (!response.ok) {
    throw new Error('Seed image approval failed');
  }
  const approved = await db.collection('media').findOne({ _id: mediaId, status: 'approved', fileType: /^image\//, uploadedAt: { $exists: true } });
  if (!approved) throw new Error('Seed image was not approved');
}

function svg(title, topic, index) {
  const hue = (index * 37) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue},70%,48%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},75%,58%)"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/><circle cx="${220 + (index % 5) * 170}" cy="${180 + (index % 4) * 130}" r="${90 + (index % 3) * 30}" fill="rgba(255,255,255,.18)"/><rect x="90" y="610" width="1020" height="170" rx="28" fill="rgba(15,23,42,.72)"/><text x="130" y="690" fill="white" font-family="Arial,sans-serif" font-size="46" font-weight="700">${title}</text><text x="130" y="745" fill="rgba(255,255,255,.82)" font-family="Arial,sans-serif" font-size="26">${topic.replace(/_/g, ' ')}</text></svg>`;
}

function runFfmpegForReel(path, _title, index) {
  const hue = (index * 17) % 360;
  run('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `testsrc2=s=720x1280:d=5:r=30,eq=saturation=0.75:brightness=0.02,hue=h=${hue}*PI/180+0.8*t`,
    '-vf', 'drawbox=x=60+120*sin(t*1.7):y=140+160*cos(t*1.1):w=520:h=520:color=white@0.16:t=fill,drawbox=x=260+180*cos(t*1.3):y=760+120*sin(t*2.1):w=340:h=220:color=black@0.20:t=fill',
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    path,
  ]);
}

const now = new Date();
mkdirSync(join(mediaRoot, 'demo-social', 'images'), { recursive: true });
mkdirSync(join(mediaRoot, 'demo-social', 'reel-sources'), { recursive: true });

for (let i = 0; i < NAMES.length; i += 1) {
  const [name, handle] = NAMES[i];
  await db.collection('users').updateOne(
    { email: `demo-social-${i + 1}@local.blabber.dev` },
    {
      $setOnInsert: {
        _id: idFor('user', handle),
        email: `demo-social-${i + 1}@local.blabber.dev`,
        passwordHash: 'demo-local-login-disabled',
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
        creatorTopicIds: [TOPICS[i % TOPICS.length], TOPICS[(i + 3) % TOPICS.length]],
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

const creators = await db.collection('users').find({ email: /^demo-social-\d+@local\.blabber\.dev$/ }).sort({ email: 1 }).toArray();

for (let i = 0; i < 60; i += 1) {
  const author = creators[i % creators.length];
  const topic = TOPICS[i % TOPICS.length];
  const mediaId = idFor('post-media', String(i));
  const postId = idFor('post', String(i));
  await approveSeedImage({ author, mediaId, index: i, topic });
  await db.collection('posts').updateOne(
    { _id: postId },
    {
      $setOnInsert: { _id: postId, createdAt: new Date(now.getTime() - i * 600_000) },
      $set: {
        authorUserId: author._id,
        body: `A practical note on ${topic.replace(/_/g, ' ')} for builders exploring Blabber today.`,
        visibility: 'public',
        mediaIds: [mediaId],
        discoverable: true,
        discoveryTopicIds: [topic, TOPICS[(i + 2) % TOPICS.length]].slice(0, 2),
        discoverableUpdatedAt: new Date(now.getTime() - i * 600_000),
        commentCount: 0,
        reactionCounts: {},
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

const technicalContentPattern = /smoke|fixture|test creator|test post|fake reel|seed record/i;
await db.collection('posts').updateMany(
  {
    _id: { $nin: Array.from({ length: 60 }, (_, i) => idFor('post', String(i))) },
    body: technicalContentPattern,
  },
  { $set: { discoverable: false, discoverableUpdatedAt: now, updatedAt: now } }
);
await db.collection('reels').updateMany(
  {
    _id: { $nin: Array.from({ length: 24 }, (_, i) => idFor('reel', String(i))) },
    $or: [
      { caption: technicalContentPattern },
      { processingKey: technicalContentPattern },
    ],
  },
  { $set: { reelDiscoverable: false, reelDiscoverableUpdatedAt: now, updatedAt: now } }
);

for (let i = 0; i < 6; i += 1) {
  const owner = creators[i];
  const communityId = idFor('community', String(i));
  const handle = `blabber_circle_${i + 1}`;
  await db.collection('communities').updateOne(
    { _id: communityId },
    {
      $setOnInsert: { _id: communityId, createdAt: now },
      $set: {
        ownerUserId: owner._id,
        name: ['Builder Commons', 'Design Table', 'Startup Notes', 'Learning Lab', 'Travel Desk', 'Food Studio'][i],
        handle,
        description: 'A local demo Community with safe generated discussion prompts.',
        membershipMode: 'open',
        postingPolicy: 'everyone',
        memberCount: 1,
        communityDiscoverable: true,
        communityTopicIds: [TOPICS[i], TOPICS[(i + 4) % TOPICS.length]],
        discoverableUpdatedAt: new Date(now.getTime() - i * 900_000),
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  await db.collection('community_memberships').updateOne(
    { communityId, userId: owner._id },
    { $setOnInsert: { _id: idFor('community-member', String(i)), communityId, userId: owner._id, role: 'owner', postingRestricted: false, joinedAt: now, createdAt: now, updatedAt: now } },
    { upsert: true }
  );
}

for (let i = 0; i < 24; i += 1) {
  const author = creators[i % creators.length];
  const mediaId = idFor('reel-media', String(i));
  const reelId = idFor('reel', String(i));
  const sourcePath = join(mediaRoot, 'demo-social', 'reel-sources', `${mediaId}.mp4`);
  runFfmpegForReel(sourcePath, `Demo Reel ${i + 1}`, i);
  const sourceBuffer = readFileSync(sourcePath);
  const existingSource = await db.collection('media').findOne({ _id: mediaId });
  const needsSourceApproval = existingSource?.status !== 'approved' || existingSource?.scanResult !== 'clean' || existingSource?.fileSize !== sourceBuffer.length;
  if (needsSourceApproval) {
    await db.collection('media').updateOne(
      { _id: mediaId },
      {
        $setOnInsert: { _id: mediaId, createdAt: now },
        $set: {
          userId: author._id,
          fileName: `short-video-${i + 1}.mp4`,
          originalFileName: `short-video-${i + 1}.mp4`,
          fileType: 'video/mp4',
          fileSize: sourceBuffer.length,
          s3Key: `demo-social/reels/${mediaId}.mp4`,
          url: '',
          storage: 'local',
          localPath: join(mediaRoot, 'reel-sources', `${mediaId}.mp4`),
          status: 'pending',
          purpose: 'reel_source',
          reelId,
          updatedAt: now,
        },
        $unset: {
          detectedFileType: '',
          scanMode: '',
          scanResult: '',
          scanErrorCategory: '',
          approvedAt: '',
          uploadedAt: '',
          rejectedAt: '',
        },
      },
      { upsert: true }
    );
    await db.collection('reels').updateOne(
      { _id: reelId },
      {
        $setOnInsert: { _id: reelId, createdAt: new Date(now.getTime() - i * 700_000), schemaVersion: 1 },
        $set: {
          authorUserId: author._id,
          sourceMediaId: mediaId,
          processingStatus: 'upload_initiated',
          publishState: 'draft',
          caption: '',
          visibility: 'followers',
          topicIds: [],
          processingKey: `demo-social-reel-${i}`,
          updatedAt: now,
        },
        $unset: { fallbackPath: '', posterPath: '', hlsPlaylistPath: '', hlsSegments: '', deletedAt: '', moderationRemovedAt: '' },
      },
      { upsert: true }
    );
    const response = await fetch(`http://localhost:${process.env.PORT || 3005}/reels/uploads/${reelId.toString()}/source`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessTokenFor(author)}`,
        'Content-Type': 'video/mp4',
      },
      body: sourceBuffer,
    });
    if (!response.ok) throw new Error('Seed Reel source approval failed');
  }
  const existingReel = await db.collection('reels').findOne({ _id: reelId });
  const reelSet = {
    authorUserId: author._id,
    sourceMediaId: mediaId,
    caption: `Original motion study for ${TOPICS[i % TOPICS.length].replace(/_/g, ' ')}.`,
    visibility: 'public',
    topicIds: [TOPICS[i % TOPICS.length]],
    reelDiscoverable: true,
    reelTopicIds: [TOPICS[i % TOPICS.length], TOPICS[(i + 5) % TOPICS.length]],
    reelDiscoverableUpdatedAt: now,
    reactionCounts: existingReel?.reactionCounts || {},
    commentCount: existingReel?.commentCount || 0,
    processingKey: `demo-social-reel-${i}`,
    publishState: 'published',
    publishedAt: existingReel?.publishedAt || new Date(now.getTime() - i * 700_000),
    updatedAt: now,
  };
  if (existingReel?.processingStatus !== 'ready') reelSet.processingStatus = 'uploaded';
  await db.collection('reels').updateOne(
    { _id: reelId },
    {
      $setOnInsert: { _id: reelId, createdAt: new Date(now.getTime() - i * 700_000), schemaVersion: 1 },
      $set: reelSet,
      $unset: existingReel?.processingStatus === 'ready' ? { deletedAt: '', moderationRemovedAt: '' } : { deletedAt: '', moderationRemovedAt: '', fallbackPath: '', posterPath: '', hlsPlaylistPath: '', hlsSegments: '' },
    },
    { upsert: true }
  );
}

for (let i = 0; i < 30; i += 1) {
  const result = spawnSync('node', ['-e', "const { connectToDatabase, closeDatabase } = require('/app/services/media/dist/db.js'); const { processOnePendingReel } = require('/app/services/media/dist/reel-processing.js'); (async () => { await connectToDatabase(); const processed = await processOnePendingReel(); await closeDatabase(); process.exit(processed ? 0 : 2); })().catch((error) => { console.error(error && error.message ? error.message : 'processor_failed'); process.exit(1); });"], { stdio: 'inherit' });
  if (result.status === 2) break;
  if (result.status !== 0) process.exit(result.status || 1);
}

const [postCount, reelCount, creatorCount, communityCount] = await Promise.all([
  db.collection('posts').countDocuments({ _id: { $in: Array.from({ length: 60 }, (_, i) => idFor('post', String(i))) } }),
  db.collection('reels').countDocuments({ _id: { $in: Array.from({ length: 24 }, (_, i) => idFor('reel', String(i))) }, processingStatus: 'ready' }),
  db.collection('users').countDocuments({ email: /^demo-social-\d+@local\.blabber\.dev$/ }),
  db.collection('communities').countDocuments({ _id: { $in: Array.from({ length: 6 }, (_, i) => idFor('community', String(i))) } }),
]);

console.log(JSON.stringify({ creators: creatorCount, posts: postCount, readyReels: reelCount, communities: communityCount }, null, 2));
await mongo.close();
