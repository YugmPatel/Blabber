import { promises as fs } from 'fs';
import { resolve } from 'path';
import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

const MEDIA_ROOT = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';

function isSafeLocalMediaPath(path: string) {
  const root = resolve(MEDIA_ROOT);
  const target = resolve(path);
  return target === root || target.startsWith(`${root}/`);
}

export async function deleteMomentVideoArtifacts(videoId: ObjectId) {
  const db = getDatabase();
  const now = new Date();
  await db.collection('moment_videos').updateOne(
    { _id: videoId },
    {
      $set: { processingStatus: 'deleted', deletedAt: now, updatedAt: now },
      $unset: { processingLeaseId: '', processingStartedAt: '' },
    }
  );
  await db.collection('moment_video_playback_sessions').updateMany(
    { videoId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now } }
  );

  const outputDir = resolve(MEDIA_ROOT, 'moment-videos', videoId.toString());
  if (isSafeLocalMediaPath(outputDir)) {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
