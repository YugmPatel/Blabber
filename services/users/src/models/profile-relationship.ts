import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type ProfileRelationshipState = 'following' | 'requested';

export interface ProfileRelationship {
  _id: ObjectId;
  followerUserId: ObjectId;
  targetUserId: ObjectId;
  state: ProfileRelationshipState;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
}

export function getProfileRelationshipsCollection(): Collection<ProfileRelationship> {
  return getDatabase().collection<ProfileRelationship>('profile_relationships');
}

export async function createProfileRelationshipIndexes(): Promise<void> {
  const collection = getProfileRelationshipsCollection();
  await collection.createIndex(
    { followerUserId: 1, targetUserId: 1 },
    { unique: true, name: 'profile_relationship_unique_pair' }
  );
  await collection.createIndex({ targetUserId: 1, state: 1, updatedAt: -1 }, { name: 'profile_relationship_target_state' });
  await collection.createIndex({ followerUserId: 1, state: 1, updatedAt: -1 }, { name: 'profile_relationship_follower_state' });
  await collection.createIndex({ targetUserId: 1, followerUserId: 1 }, { name: 'profile_relationship_pending_review' });
}

export async function deleteRelationshipsBetween(userA: ObjectId, userB: ObjectId): Promise<void> {
  await getProfileRelationshipsCollection().deleteMany({
    $or: [
      { followerUserId: userA, targetUserId: userB },
      { followerUserId: userB, targetUserId: userA },
    ],
  });
}
