import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityJoinRequestDocument {
  _id: ObjectId;
  communityId: ObjectId;
  requesterUserId: ObjectId;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

export function getCommunityJoinRequestsCollection() {
  return getDatabase().collection<CommunityJoinRequestDocument>('community_join_requests');
}

export async function createCommunityJoinRequestIndexes() {
  const collection = getCommunityJoinRequestsCollection();
  await collection.createIndex(
    { communityId: 1, requesterUserId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
  );
  await collection.createIndex({ requesterUserId: 1, createdAt: -1 });
}
