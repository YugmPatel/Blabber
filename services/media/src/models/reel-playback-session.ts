import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface ReelPlaybackSessionDocument {
  _id: ObjectId;
  tokenHash: string;
  viewerUserId: ObjectId;
  reelId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  schemaVersion: 1;
}

export function getReelPlaybackSessionsCollection(): Collection<ReelPlaybackSessionDocument> {
  return getDatabase().collection<ReelPlaybackSessionDocument>('reel_playback_sessions');
}

export async function createReelPlaybackSessionIndexes() {
  const collection = getReelPlaybackSessionsCollection();
  await collection.createIndex({ tokenHash: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ viewerUserId: 1, reelId: 1, createdAt: -1 });
}
