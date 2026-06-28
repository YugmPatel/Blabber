import { promises as fs } from 'fs';
import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

function isLocalMediaPath(path: string) {
  const root = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';
  return path === root || path.startsWith(`${root}/`);
}

export async function safelyDeleteMomentMedia(mediaId: ObjectId, excludingMomentId?: ObjectId) {
  const db = getDatabase();
  const [otherMoment, messageReference, avatarReference] = await Promise.all([
    db.collection('moments').findOne({
      mediaId,
      archiveState: { $ne: 'deleted' },
      ...(excludingMomentId ? { _id: { $ne: excludingMomentId } } : {}),
    }),
    db.collection('messages').findOne({
      $or: [{ 'media.mediaId': mediaId.toString() }, { 'attachments.mediaId': mediaId.toString() }],
    }),
    db.collection('users').findOne({ avatarUrl: { $regex: mediaId.toString() } }),
  ]);

  if (otherMoment || messageReference || avatarReference) return { deleted: false };

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
