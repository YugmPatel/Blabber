import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type DiscoveryFeedbackTargetType = 'post' | 'creator' | 'community' | 'topic' | 'reel';
export type DiscoveryFeedbackType = 'not_interested' | 'muted';

export interface DiscoveryFeedbackDocument {
  _id: ObjectId;
  userId: ObjectId;
  targetType: DiscoveryFeedbackTargetType;
  targetId: ObjectId | string;
  feedbackType: DiscoveryFeedbackType;
  createdAt: Date;
  updatedAt: Date;
}

export function getDiscoveryFeedbackCollection(): Collection<DiscoveryFeedbackDocument> {
  return getDatabase().collection<DiscoveryFeedbackDocument>('discovery_feedback');
}

export async function createDiscoveryFeedbackIndexes() {
  const collection = getDiscoveryFeedbackCollection();
  await collection.createIndex(
    { userId: 1, targetType: 1, targetId: 1, feedbackType: 1 },
    { unique: true, name: 'feedback_owner_target_unique' }
  );
  await collection.createIndex({ targetType: 1, targetId: 1 });
}
