import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface ReelForYouExplanationSnapshot {
  reelId: ObjectId;
  code: string;
  topicId?: string;
  topicLabel?: string;
  creatorHandle?: string;
}

export interface ReelForYouSessionDocument {
  _id: ObjectId;
  sessionHash: string;
  userId: ObjectId;
  rankingModelVersion: string;
  orderedReelIds: ObjectId[];
  explanations: ReelForYouExplanationSnapshot[];
  createdAt: Date;
  expiresAt: Date;
  refreshGeneration: number;
  schemaVersion: 1;
}

export function getReelForYouSessionsCollection(): Collection<ReelForYouSessionDocument> {
  return getDatabase().collection<ReelForYouSessionDocument>('reel_for_you_sessions');
}

export async function createReelForYouSessionIndexes() {
  const collection = getReelForYouSessionsCollection();
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'reel_for_you_session_ttl' });
  await collection.createIndex({ sessionHash: 1 }, { unique: true, name: 'reel_for_you_session_hash' });
  await collection.createIndex({ userId: 1, createdAt: -1 }, { name: 'reel_for_you_user_created' });
}
