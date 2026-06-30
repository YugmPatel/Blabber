import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityInviteDocument {
  _id: ObjectId;
  communityId: ObjectId;
  tokenHash: string;
  createdByUserId: ObjectId;
  expiresAt?: Date;
  maxUses?: number;
  useCount: number;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getCommunityInvitesCollection() {
  return getDatabase().collection<CommunityInviteDocument>('community_invites');
}

export async function createCommunityInviteIndexes() {
  const collection = getCommunityInvitesCollection();
  await collection.createIndex({ tokenHash: 1 }, { unique: true });
  await collection.createIndex({ communityId: 1, revokedAt: 1, createdAt: -1 });
}
