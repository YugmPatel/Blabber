import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type CommunityMembershipMode = 'open' | 'approval_required' | 'private';
export type CommunityPostingPolicy = 'everyone' | 'mods_admins' | 'admins_only';

export interface CommunityDocument {
  _id: ObjectId;
  ownerUserId: ObjectId;
  name: string;
  handle: string;
  description: string;
  avatarMediaId?: ObjectId;
  membershipMode: CommunityMembershipMode;
  postingPolicy: CommunityPostingPolicy;
  memberCount: number;
  communityDiscoverable?: boolean;
  communityTopicIds?: string[];
  discoverableUpdatedAt?: Date;
  handleChangedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export function getCommunitiesCollection() {
  return getDatabase().collection<CommunityDocument>('communities');
}

export async function createCommunityIndexes() {
  const collection = getCommunitiesCollection();
  await collection.createIndex({ handle: 1 }, { unique: true });
  await collection.createIndex({ ownerUserId: 1, deletedAt: 1 });
  await collection.createIndex({ membershipMode: 1, deletedAt: 1 });
  await collection.createIndex(
    { communityDiscoverable: 1, membershipMode: 1, deletedAt: 1, discoverableUpdatedAt: -1 },
    { name: 'community_discovery_browse' }
  );
  await collection.createIndex({ communityTopicIds: 1, communityDiscoverable: 1 }, { name: 'community_discovery_topics' });
}
