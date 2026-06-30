import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface ForYouExplanationSnapshot {
  postId: ObjectId;
  code: string;
  topicId?: string;
  topicLabel?: string;
  creatorHandle?: string;
}

export interface DiscoveryForYouSessionDocument {
  _id: ObjectId;
  sessionHash: string;
  userId: ObjectId;
  rankingModelVersion: string;
  candidatePostIds: ObjectId[];
  explanations: ForYouExplanationSnapshot[];
  createdAt: Date;
  expiresAt: Date;
  refreshGeneration: number;
  schemaVersion: 1;
}

export function getDiscoveryForYouSessionsCollection(): Collection<DiscoveryForYouSessionDocument> {
  return getDatabase().collection<DiscoveryForYouSessionDocument>('discovery_for_you_sessions');
}

export async function createDiscoveryForYouSessionIndexes() {
  const collection = getDiscoveryForYouSessionsCollection();
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'discovery_for_you_session_ttl' });
  await collection.createIndex({ sessionHash: 1 }, { unique: true, name: 'discovery_for_you_session_hash' });
  await collection.createIndex({ userId: 1, createdAt: -1 }, { name: 'discovery_for_you_user_created' });
}

export async function cleanupExpiredDiscoveryForYouSessions(now = new Date()) {
  const result = await getDiscoveryForYouSessionsCollection().deleteMany({ expiresAt: { $lte: now } });
  return result.deletedCount || 0;
}
