import { ObjectId } from 'mongodb';
import { getMediaCollection } from './models/media';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function assertUserUploadQuota(userId: ObjectId, nextBytes: number) {
  const limit = Number(process.env.MEDIA_USER_DAILY_QUOTA_BYTES || 500 * 1024 * 1024);
  if (!Number.isFinite(limit) || limit <= 0) return;
  const since = new Date(Date.now() - DAY_MS);
  const [result] = await getMediaCollection()
    .aggregate<{ total: number }>([
      { $match: { userId, createdAt: { $gte: since }, status: { $nin: ['rejected', 'deleted'] } } },
      { $group: { _id: null, total: { $sum: '$fileSize' } } },
    ])
    .toArray();
  if ((result?.total || 0) + nextBytes > limit) {
    throw new Error('quota_exceeded');
  }
}
