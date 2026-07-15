// Apply-time orchestration: turns a resolved content plan (content-plan.mjs
// + resolve-asset.mjs picks) into real, idempotent writes — real Mongo
// documents, and for photos/reels, driving the exact same authenticated
// HTTP pipeline a browser upload would (so malware scanning and, for reels,
// real ffmpeg transcoding always run for real; see
// services/media/src/routes/{presign,reels}.ts). This intentionally mirrors
// scripts/import-pexels-demo-content.mjs and scripts/seed-demo-social.mjs's
// proven approach field-for-field rather than inventing a new one.

import { createHmac } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { idHexFor } from './seed-keys.mjs';
import { localMediaRoot, mediaServicePort, SEED_NAMESPACE, SEED_VERSION } from './config.mjs';
import { generateAccountAvatar, generateLocalImage, generateLocalReelVideo } from './local-assets.mjs';

export function idFor(ObjectId, seedKey, subKind = 'primary') {
  return new ObjectId(idHexFor(seedKey, subKind));
}

function jwtBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Mints a real, validly-signed short-lived access token for a seeded user
 * — the same trick scripts/import-pexels-demo-content.mjs and
 * scripts/seed-demo-social.mjs already use, since authMiddleware only
 * verifies the JWT signature/claims, not that a browser session produced it.
 */
export function accessTokenFor(user, jwtAccessSecret) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    userId: user._id.toString(),
    username: user.username,
    email: user.email,
    iat: nowSeconds,
    exp: nowSeconds + 10 * 60,
  };
  const unsigned = `${jwtBase64Url({ alg: 'HS256', typ: 'JWT' })}.${jwtBase64Url(payload)}`;
  return `${unsigned}.${createHmac('sha256', jwtAccessSecret).update(unsigned).digest('base64url')}`;
}

export function provenanceFor({ picked, seedKey, searchQuery }) {
  const base = {
    name: SEED_NAMESPACE,
    version: SEED_VERSION,
    seedKey,
    searchQuery,
    downloadedAt: new Date(),
  };
  if (!picked || picked.provider === 'local') {
    return { ...base, source: 'generated', sourceAssetId: seedKey };
  }
  return {
    ...base,
    source: picked.provider,
    sourceAssetId: picked.sourceAssetId,
    sourceUrl: picked.downloadUrl,
    sourceAuthor: picked.photographer || undefined,
    sourceProviderUrl: picked.providerPageUrl || undefined,
    license: 'See provider terms (Pexels/Pixabay/Unsplash free-to-use license).',
    originalWidth: picked.width || undefined,
    originalHeight: picked.height || undefined,
    durationSeconds: picked.durationSeconds || undefined,
  };
}

function generatedProvenance({ seedKey, searchQuery, source = 'generated' }) {
  return {
    name: SEED_NAMESPACE,
    version: SEED_VERSION,
    seedKey,
    searchQuery,
    source,
    sourceAssetId: seedKey,
    generatedAt: new Date(),
  };
}

async function downloadBuffer(url, maxBytes, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`download_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error('download_size_rejected');
  return bytes;
}

export async function recordSeedTracking(db, { seedKey, kind, mongoId, collection, source }) {
  await db.collection('beta_content_seed_records').updateOne(
    { seedKey },
    {
      $setOnInsert: { seedKey, createdAt: new Date() },
      $set: { kind, mongoId, collection, source, updatedAt: new Date() },
    },
    { upsert: true }
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function ensureAccount(db, { ObjectId, accountSpec, now }) {
  const userId = idFor(ObjectId, accountSpec.seedKey);
  await db.collection('users').updateOne(
    { _id: userId },
    {
      $setOnInsert: {
        _id: userId,
        email: `${SEED_NAMESPACE}-${accountSpec.handle}@local.blabber.dev`,
        passwordHash: 'beta-content-seed-login-disabled',
        username: accountSpec.handle,
        contacts: [],
        blocked: [],
        createdAt: now,
      },
      $set: {
        name: accountSpec.name,
        about: accountSpec.bio,
        profileBio: accountSpec.bio,
        emailVerified: true,
        profileHandle: accountSpec.handle,
        profileVisibility: 'public',
        creatorDiscoveryEnabled: true,
        creatorDiscoveryEnabledAt: now,
        creatorTopicIds: accountSpec.topicSlugs,
        lastSeen: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  await recordSeedTracking(db, { seedKey: accountSpec.seedKey, kind: 'user', mongoId: userId, collection: 'users', source: { source: 'generated' } });
  return db.collection('users').findOne({ _id: userId });
}

async function putGeneratedImageThroughMediaPipeline(db, ObjectId, { user, seedKey, env, jwtAccessSecret, pathParts, fileName, generate, now, purpose, searchQuery }) {
  const mediaId = idFor(ObjectId, seedKey, 'media');
  const mediaRoot = localMediaRoot(env);
  const localPath = join(mediaRoot, 'beta-content', ...pathParts, `${mediaId}.jpg`);
  mkdirSync(dirname(localPath), { recursive: true });
  generate(localPath);
  const body = (await import('node:fs')).readFileSync(localPath);
  const provenance = generatedProvenance({ seedKey, searchQuery });

  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: now },
      $set: {
        userId: user._id,
        fileName,
        originalFileName: fileName,
        fileType: 'image/jpeg',
        fileSize: body.length,
        s3Key: `beta-content/${pathParts.join('/')}/${mediaId}.jpg`,
        url: `/api/media/local/${mediaId}`,
        storage: 'local',
        localPath,
        status: 'pending',
        purpose,
        importer: provenance,
        updatedAt: now,
      },
      $unset: { approvedAt: '', uploadedAt: '', scanMode: '', scanResult: '', scanErrorCategory: '', rejectedAt: '', quarantinedAt: '' },
    },
    { upsert: true }
  );

  const response = await fetch(`http://localhost:${mediaServicePort(env)}/local/${mediaId.toString()}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessTokenFor(user, jwtAccessSecret)}`, 'Content-Type': 'image/jpeg' },
    body,
  });
  if (!response.ok) throw new Error(`generated_image_pipeline_rejected_${response.status}`);
  const approved = await db.collection('media').findOne({ _id: mediaId, status: 'approved', fileType: /^image\// });
  if (!approved) throw new Error('generated_image_not_approved');

  return { mediaId, provenance, url: `/api/media/local/${mediaId}` };
}

export async function ensureAccountIdentityAssets(db, ObjectId, { accountSpec, user, env, jwtAccessSecret, ordinal, now }) {
  const avatarSpec = accountSpec.identityAssets?.avatar;
  if (!avatarSpec) return { avatar: null, cover: null };

  const avatar = await putGeneratedImageThroughMediaPipeline(db, ObjectId, {
    user,
    seedKey: avatarSpec.seedKey,
    env,
    jwtAccessSecret,
    pathParts: ['profiles', 'avatars'],
    fileName: `${accountSpec.handle}-avatar.jpg`,
    purpose: 'profile_avatar',
    searchQuery: `generated avatar for ${accountSpec.handle}`,
    now,
    generate: (outputPath) => generateAccountAvatar(outputPath, { index: ordinal, initials: avatarSpec.initials }),
  });

  await db.collection('users').updateOne(
    { _id: user._id },
    {
      $set: {
        avatarUrl: avatar.url,
        avatarSource: 'upload',
        updatedAt: now,
      },
    }
  );
  await recordSeedTracking(db, { seedKey: avatarSpec.seedKey, kind: 'profile_asset', mongoId: avatar.mediaId, collection: 'media', source: avatar.provenance });
  return { avatar, cover: null };
}

// ---------------------------------------------------------------------------
// Posts (photos)
// ---------------------------------------------------------------------------

/**
 * Downloads the picked candidate (or generates a local branded image if
 * `picked` is null), runs it through the real /local/:id upload+scan
 * pipeline, then upserts the posts document — mirroring
 * scripts/import-pexels-demo-content.mjs's approvePhoto() exactly.
 */
export async function applyPost(db, ObjectId, { author, postSpec, picked, validatedBuffer, jwtAccessSecret, env, fetchImpl = fetch, ordinal, now }) {
  const mediaId = idFor(ObjectId, postSpec.seedKey, 'media');
  const postId = idFor(ObjectId, postSpec.seedKey, 'post');
  const existing = await db.collection('posts').findOne({ _id: postId, discoverable: true });
  if (existing) return { status: 'existing', postId, mediaId };

  const mediaRoot = localMediaRoot(env);
  const localPath = join(mediaRoot, 'beta-content', 'photos', `${mediaId}.jpg`);
  let image;
  let provenance = postSpec.localAsset
    ? generatedProvenance({ seedKey: postSpec.localAsset.seedKey || postSpec.seedKey, searchQuery: postSpec.searchQuery })
    : provenanceFor({ picked, seedKey: postSpec.seedKey, searchQuery: postSpec.searchQuery });
  if (postSpec.localAsset) {
    mkdirSync(dirname(localPath), { recursive: true });
    generateLocalImage(localPath, { index: ordinal, title: postSpec.localAsset.title, caption: postSpec.caption });
    image = Buffer.alloc(0);
  } else if (picked) {
    image = validatedBuffer || await downloadBuffer(picked.downloadUrl, 18 * 1024 * 1024, fetchImpl);
  } else {
    mkdirSync(dirname(localPath), { recursive: true });
    generateLocalImage(localPath, { index: ordinal });
    image = Buffer.alloc(0); // real bytes come from the file we just wrote to disk
  }

  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: now },
      $set: {
        userId: author._id,
        fileName: `${postSpec.seedKey}.jpg`,
        originalFileName: `${postSpec.seedKey}.jpg`,
        fileType: 'image/jpeg',
        fileSize: image.length,
        s3Key: `beta-content/photos/${mediaId}.jpg`,
        url: `/api/media/local/${mediaId}`,
        storage: 'local',
        localPath,
        status: 'pending',
        purpose: 'general',
        importer: provenance,
        updatedAt: now,
      },
      $unset: { approvedAt: '', uploadedAt: '', scanMode: '', scanResult: '', scanErrorCategory: '', rejectedAt: '', quarantinedAt: '' },
    },
    { upsert: true }
  );

  const body = picked ? image : (await import('node:fs')).readFileSync(localPath);
  const response = await fetchImpl(`http://localhost:${mediaServicePort(env)}/local/${mediaId.toString()}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessTokenFor(author, jwtAccessSecret)}`, 'Content-Type': 'image/jpeg' },
    body,
  });
  if (!response.ok) throw new Error(`post_photo_pipeline_rejected_${response.status}`);
  const approved = await db.collection('media').findOne({ _id: mediaId, status: 'approved', fileType: /^image\// });
  if (!approved) throw new Error('post_photo_not_approved');

  await db.collection('posts').updateOne(
    { _id: postId },
    {
      $setOnInsert: { _id: postId, createdAt: new Date(now.getTime() - ordinal * 300_000) },
      $set: {
        authorUserId: author._id,
        body: postSpec.caption,
        visibility: 'public',
        mediaIds: [mediaId],
        discoverable: true,
        discoveryTopicIds: [postSpec.topicSlug],
        discoverableUpdatedAt: now,
        commentCount: 0,
        reactionCounts: {},
        importer: provenance,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  await recordSeedTracking(db, { seedKey: postSpec.seedKey, kind: 'post', mongoId: postId, collection: 'posts', source: provenance });
  return { status: 'applied', postId, mediaId, provenance };
}

// ---------------------------------------------------------------------------
// Reels (video)
// ---------------------------------------------------------------------------

/**
 * Downloads the picked video (or generates a local branded clip), drives the
 * real two-step reel upload pipeline (initiate + PUT source, which runs the
 * real malware scan), invokes the real ffmpeg transcode via
 * processOnePendingReel(), then flips the reel to published/discoverable —
 * mirroring scripts/import-pexels-demo-content.mjs's approveVideo() exactly.
 */
export async function applyReel(db, ObjectId, { author, reelSpec, picked, validatedBuffer, jwtAccessSecret, env, fetchImpl = fetch, ordinal, now, processReels }) {
  const mediaId = idFor(ObjectId, reelSpec.seedKey, 'media');
  const reelId = idFor(ObjectId, reelSpec.seedKey, 'reel');
  const existing = await db.collection('reels').findOne({ _id: reelId, processingStatus: 'ready', reelDiscoverable: true });
  if (existing) return { status: 'existing', reelId, mediaId };

  const mediaRoot = localMediaRoot(env);
  const sourcePath = join(mediaRoot, 'reel-sources', `${mediaId}.mp4`);
  let provenance = provenanceFor({ picked, seedKey: reelSpec.seedKey, searchQuery: reelSpec.searchQuery });
  let source;
  if (picked) {
    source = validatedBuffer || await downloadBuffer(picked.downloadUrl, 45 * 1024 * 1024, fetchImpl);
  } else {
    mkdirSync(dirname(sourcePath), { recursive: true });
    generateLocalReelVideo(sourcePath, { index: ordinal });
    source = (await import('node:fs')).readFileSync(sourcePath);
  }

  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: now },
      $set: {
        userId: author._id,
        fileName: `${reelSpec.seedKey}.mp4`,
        originalFileName: `${reelSpec.seedKey}.mp4`,
        fileType: 'video/mp4',
        fileSize: source.length,
        s3Key: `beta-content/reels/${mediaId}.mp4`,
        url: '',
        storage: 'local',
        localPath: sourcePath,
        status: 'pending',
        purpose: 'reel_source',
        reelId,
        importer: provenance,
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
        reelTopicIds: [reelSpec.topicSlug],
        processingKey: `${SEED_NAMESPACE}:${reelSpec.seedKey}`,
        importer: provenance,
        updatedAt: now,
      },
      $unset: { fallbackPath: '', posterPath: '', hlsPlaylistPath: '', hlsSegments: '', deletedAt: '', moderationRemovedAt: '' },
    },
    { upsert: true }
  );

  const response = await fetchImpl(`http://localhost:${mediaServicePort(env)}/reels/uploads/${reelId.toString()}/source`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessTokenFor(author, jwtAccessSecret)}`, 'Content-Type': 'video/mp4' },
    body: source,
  });
  if (!response.ok) throw new Error(`reel_video_upload_rejected_${response.status}`);

  await processReels();

  const ready = await db.collection('reels').findOne({ _id: reelId, processingStatus: 'ready', fallbackPath: { $exists: true }, posterPath: { $exists: true } });
  if (!ready) {
    const rejected = await db.collection('reels').findOne({ _id: reelId, processingStatus: { $in: ['rejected', 'failed'] } });
    throw new Error(rejected?.validationFailureCategory || 'reel_not_ready_after_processing');
  }

  await db.collection('reels').updateOne(
    { _id: reelId, processingStatus: 'ready' },
    {
      $set: {
        caption: reelSpec.caption,
        visibility: 'public',
        topicIds: [reelSpec.topicSlug],
        reelDiscoverable: true,
        reelTopicIds: [reelSpec.topicSlug],
        reelDiscoverableUpdatedAt: now,
        reactionCounts: ready.reactionCounts || {},
        commentCount: ready.commentCount || 0,
        publishState: 'published',
        publishedAt: ready.publishedAt || new Date(now.getTime() - ordinal * 450_000),
        importer: provenance,
        updatedAt: now,
      },
    }
  );

  await recordSeedTracking(db, { seedKey: reelSpec.seedKey, kind: 'reel', mongoId: reelId, collection: 'reels', source: provenance });
  return { status: 'applied', reelId, mediaId, provenance };
}

// ---------------------------------------------------------------------------
// Comments / reactions (direct inserts — no HTTP route needed, but the
// denormalized commentCount/reactionCounts caches on the parent
// post/reel document must be kept in sync manually, same caveat the
// research surfaced for both services).
// ---------------------------------------------------------------------------

export async function applyComment(db, ObjectId, { commentSpec, commenter, targetPostId, targetReelId, now }) {
  const commentId = idFor(ObjectId, commentSpec.seedKey, 'comment');
  if (commentSpec.targetKind === 'post') {
    const post = await db.collection('posts').findOne({ _id: targetPostId });
    if (!post) throw new Error('comment_target_post_missing');
    await db.collection('post_comments').updateOne(
      { _id: commentId },
      { $setOnInsert: { _id: commentId, postId: targetPostId, postAuthorUserId: post.authorUserId, authorUserId: commenter._id, body: commentSpec.body, createdAt: now } },
      { upsert: true }
    );
    const commentCount = await db.collection('post_comments').countDocuments({ postId: targetPostId, deletedAt: { $exists: false } });
    await db.collection('posts').updateOne({ _id: targetPostId }, { $set: { commentCount, updatedAt: now } });
  } else {
    const reel = await db.collection('reels').findOne({ _id: targetReelId });
    if (!reel) throw new Error('comment_target_reel_missing');
    await db.collection('reel_comments').updateOne(
      { _id: commentId },
      { $setOnInsert: { _id: commentId, reelId: targetReelId, reelAuthorUserId: reel.authorUserId, authorUserId: commenter._id, body: commentSpec.body, createdAt: now } },
      { upsert: true }
    );
    const commentCount = await db.collection('reel_comments').countDocuments({ reelId: targetReelId, deletedAt: { $exists: false } });
    await db.collection('reels').updateOne({ _id: targetReelId }, { $set: { commentCount, updatedAt: now } });
  }
  await recordSeedTracking(db, { seedKey: commentSpec.seedKey, kind: 'comment', mongoId: commentId, collection: commentSpec.targetKind === 'post' ? 'post_comments' : 'reel_comments', source: { source: 'generated' } });
}

async function recomputeReactionCounts(db, collectionName, targetField, targetId) {
  const rows = await db
    .collection(collectionName)
    .aggregate([{ $match: { [targetField]: targetId } }, { $group: { _id: '$emoji', count: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

export async function applyReaction(db, ObjectId, { reactionSpec, reactor, targetPostId, targetReelId, now }) {
  if (reactionSpec.targetKind === 'post') {
    const post = await db.collection('posts').findOne({ _id: targetPostId });
    if (!post) throw new Error('reaction_target_post_missing');
    await db.collection('post_reactions').updateOne(
      { postId: targetPostId, reactingUserId: reactor._id },
      {
        $setOnInsert: { _id: idFor(ObjectId, reactionSpec.seedKey, 'reaction'), postId: targetPostId, authorUserId: post.authorUserId, reactingUserId: reactor._id, createdAt: now },
        $set: { emoji: reactionSpec.emoji, updatedAt: now },
      },
      { upsert: true }
    );
    const reactionCounts = await recomputeReactionCounts(db, 'post_reactions', 'postId', targetPostId);
    await db.collection('posts').updateOne({ _id: targetPostId }, { $set: { reactionCounts, updatedAt: now } });
  } else {
    const reel = await db.collection('reels').findOne({ _id: targetReelId });
    if (!reel) throw new Error('reaction_target_reel_missing');
    await db.collection('reel_reactions').updateOne(
      { reelId: targetReelId, reactingUserId: reactor._id },
      {
        $setOnInsert: { _id: idFor(ObjectId, reactionSpec.seedKey, 'reaction'), reelId: targetReelId, authorUserId: reel.authorUserId, reactingUserId: reactor._id, createdAt: now },
        $set: { emoji: reactionSpec.emoji, updatedAt: now },
      },
      { upsert: true }
    );
    const reactionCounts = await recomputeReactionCounts(db, 'reel_reactions', 'reelId', targetReelId);
    await db.collection('reels').updateOne({ _id: targetReelId }, { $set: { reactionCounts, updatedAt: now } });
  }
}

// ---------------------------------------------------------------------------
// Follow graph
// ---------------------------------------------------------------------------

export async function applyFollow(db, ObjectId, { followSpec, follower, target, now }) {
  await db.collection('profile_relationships').updateOne(
    { followerUserId: follower._id, targetUserId: target._id },
    {
      $setOnInsert: { _id: idFor(ObjectId, followSpec.seedKey, 'follow'), followerUserId: follower._id, targetUserId: target._id, createdAt: now },
      // All beta accounts are profileVisibility: 'public', so the equivalent
      // real API call (POST /profiles/:handle/follow) would resolve
      // immediately to 'following' too — see services/users/src/routes/
      // profiles.ts's followProfile.
      $set: { state: 'following', approvedAt: now, updatedAt: now },
    },
    { upsert: true }
  );
  await recordSeedTracking(db, { seedKey: followSpec.seedKey, kind: 'follow', mongoId: idFor(ObjectId, followSpec.seedKey, 'follow'), collection: 'profile_relationships', source: { source: 'generated' } });
}
