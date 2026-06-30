import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type DiscoveryTargetType = 'post' | 'creator' | 'community' | 'topic' | 'reel';
export type DiscoverySourceContext = 'discover' | 'topic_browse' | 'creator_browse' | 'community_browse' | 'for_you' | 'reels_browse' | 'reels_for_you';
export type DiscoveryDwellBucket =
  | 'under_3_seconds'
  | '3_to_10_seconds'
  | '10_to_30_seconds'
  | '30_to_60_seconds'
  | 'over_30_seconds'
  | 'over_60_seconds'
  | 'under_25_percent'
  | '25_to_50_percent'
  | '50_to_75_percent'
  | '75_to_95_percent'
  | 'over_95_percent'
  | 'user_next_reel';

export interface DiscoveryEventDocument {
  _id: ObjectId;
  userId: ObjectId;
  targetType: DiscoveryTargetType;
  targetId: ObjectId | string;
  eventType: string;
  sourceContext: DiscoverySourceContext;
  topicIds: string[];
  dwellBucket?: DiscoveryDwellBucket;
  dedupeKey: string;
  createdAt: Date;
  expiresAt: Date;
  schemaVersion: 1;
}

export function getDiscoveryEventsCollection(): Collection<DiscoveryEventDocument> {
  return getDatabase().collection<DiscoveryEventDocument>('discovery_events');
}

export async function createDiscoveryEventIndexes() {
  const collection = getDiscoveryEventsCollection();
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'discovery_event_ttl' });
  await collection.createIndex({ userId: 1, createdAt: -1 });
  await collection.createIndex({ dedupeKey: 1 }, { unique: true });
}

export async function cleanupExpiredDiscoveryEvents(now = new Date()) {
  const result = await getDiscoveryEventsCollection().deleteMany({ expiresAt: { $lte: now } });
  return result.deletedCount || 0;
}
