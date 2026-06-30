import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityModerationActivityDocument {
  _id: ObjectId;
  communityId: ObjectId;
  actorUserId?: ObjectId;
  targetUserId?: ObjectId;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export function getCommunityModerationActivityCollection() {
  return getDatabase().collection<CommunityModerationActivityDocument>('community_moderation_activity');
}

export async function createCommunityModerationActivityIndexes() {
  const collection = getCommunityModerationActivityCollection();
  await collection.createIndex({ communityId: 1, createdAt: -1 });
  await collection.createIndex({ actorUserId: 1, createdAt: -1 });
}
