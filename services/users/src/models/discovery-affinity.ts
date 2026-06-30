import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type DiscoveryAffinityType = 'creator' | 'topic';
export type DiscoveryAffinitySurface = 'posts' | 'reels';

export interface DiscoveryAffinityDocument {
  _id: ObjectId;
  userId: ObjectId;
  surface?: DiscoveryAffinitySurface;
  affinityType: DiscoveryAffinityType;
  affinityKey: ObjectId | string;
  score: number;
  lastSignalAt: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  schemaVersion: 1;
}

export function getDiscoveryAffinitiesCollection(): Collection<DiscoveryAffinityDocument> {
  return getDatabase().collection<DiscoveryAffinityDocument>('discovery_affinities');
}

export async function createDiscoveryAffinityIndexes() {
  const collection = getDiscoveryAffinitiesCollection();
  await collection.dropIndex('discovery_affinity_identity').catch(() => undefined);
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'discovery_affinity_ttl' });
  await collection.createIndex({ userId: 1, surface: 1, affinityType: 1, affinityKey: 1 }, { unique: true, name: 'discovery_affinity_identity_surface' });
  await collection.createIndex({ userId: 1, surface: 1, affinityType: 1, score: -1 }, { name: 'discovery_affinity_rank_surface' });
}

export async function cleanupExpiredDiscoveryAffinities(now = new Date()) {
  const result = await getDiscoveryAffinitiesCollection().deleteMany({ expiresAt: { $lte: now } });
  return result.deletedCount || 0;
}
