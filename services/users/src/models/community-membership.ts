import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface CommunityMembershipDocument {
  _id: ObjectId;
  communityId: ObjectId;
  userId: ObjectId;
  role: CommunityRole;
  postingRestricted: boolean;
  restrictedByUserId?: ObjectId;
  restrictedAt?: Date;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getCommunityMembershipsCollection() {
  return getDatabase().collection<CommunityMembershipDocument>('community_memberships');
}

export async function createCommunityMembershipIndexes() {
  const collection = getCommunityMembershipsCollection();
  await collection.createIndex({ communityId: 1, userId: 1 }, { unique: true });
  await collection.createIndex({ userId: 1, joinedAt: -1 });
  await collection.createIndex({ communityId: 1, role: 1 });
}
