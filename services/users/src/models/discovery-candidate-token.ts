import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { DiscoverySourceContext, DiscoveryTargetType } from './discovery-event';

export interface DiscoveryCandidateTokenDocument {
  _id: ObjectId;
  tokenHash: string;
  viewerUserId: ObjectId;
  targetType: DiscoveryTargetType;
  targetId: ObjectId | string;
  sourceContext: DiscoverySourceContext;
  createdAt: Date;
  expiresAt: Date;
  consumedEventKeys?: string[];
}

export function getDiscoveryCandidateTokensCollection(): Collection<DiscoveryCandidateTokenDocument> {
  return getDatabase().collection<DiscoveryCandidateTokenDocument>('discovery_candidate_tokens');
}

export async function createDiscoveryCandidateTokenIndexes() {
  const collection = getDiscoveryCandidateTokensCollection();
  await collection.createIndex({ tokenHash: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'discovery_candidate_token_ttl' });
  await collection.createIndex({ viewerUserId: 1, targetType: 1, targetId: 1 });
}
