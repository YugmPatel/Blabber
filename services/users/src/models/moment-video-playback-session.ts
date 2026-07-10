import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface MomentVideoPlaybackSessionDocument {
  _id: ObjectId;
  viewerUserId: ObjectId;
  momentId: ObjectId;
  videoId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  schemaVersion: number;
}

export function getMomentVideoPlaybackSessionsCollection(): Collection<MomentVideoPlaybackSessionDocument> {
  return getDatabase().collection<MomentVideoPlaybackSessionDocument>('moment_video_playback_sessions');
}

export async function createMomentVideoPlaybackSessionIndexes(): Promise<void> {
  const collection = getMomentVideoPlaybackSessionsCollection();
  try {
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' });
    await collection.createIndex({ viewerUserId: 1, momentId: 1, createdAt: -1 }, { name: 'viewer_moment_createdAt' });
    await collection.createIndex({ videoId: 1 }, { name: 'videoId' });
    logger.info('Moment video playback session indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create Moment video playback session indexes');
    throw error;
  }
}
