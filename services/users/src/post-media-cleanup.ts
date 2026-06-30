import { promises as fs } from 'fs';
import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

function isLocalMediaPath(path: string) {
  const root = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
  return path === root || path.startsWith(`${root}/`);
}

export async function safelyDeletePostMedia(mediaId: ObjectId, excludingPostId?: ObjectId) {
  const db = getDatabase();
  const [postReference, momentReference, communityReference, communityPostReference, messageReference, avatarReference] = await Promise.all([
    db.collection('posts').findOne({
      mediaIds: mediaId,
      deletedAt: { $exists: false },
      ...(excludingPostId ? { _id: { $ne: excludingPostId } } : {}),
    }),
    db.collection('moments').findOne({ mediaId, archiveState: { $ne: 'deleted' } }),
    db.collection('communities').findOne({ avatarMediaId: mediaId, deletedAt: { $exists: false } }),
    db.collection('community_posts').findOne({ mediaIds: mediaId, deletedAt: { $exists: false } }),
    db.collection('messages').findOne({
      $or: [{ 'media.mediaId': mediaId.toString() }, { 'attachments.mediaId': mediaId.toString() }],
    }),
    db.collection('users').findOne({ avatarUrl: { $regex: mediaId.toString() } }),
  ]);

  if (postReference || momentReference || communityReference || communityPostReference || messageReference || avatarReference) return { deleted: false };

  const media = await db.collection('media').findOne({ _id: mediaId });
  if (!media) return { deleted: false };

  await db.collection('media').updateOne(
    { _id: mediaId },
    { $set: { status: 'deleted', deletedAt: new Date() }, $unset: { url: '', publicUrl: '' } }
  );

  if (typeof media.localPath === 'string' && isLocalMediaPath(media.localPath)) {
    await fs.unlink(media.localPath).catch(() => undefined);
  }

  return { deleted: true };
}
