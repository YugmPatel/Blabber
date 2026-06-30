import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityBanDocument {
  _id: ObjectId;
  communityId: ObjectId;
  userId: ObjectId;
  bannedByUserId: ObjectId;
  createdAt: Date;
}

export function getCommunityBansCollection() {
  return getDatabase().collection<CommunityBanDocument>('community_bans');
}

export async function createCommunityBanIndexes() {
  const collection = getCommunityBansCollection();
  await collection.createIndex({ communityId: 1, userId: 1 }, { unique: true });
  await collection.createIndex({ userId: 1, createdAt: -1 });
}
