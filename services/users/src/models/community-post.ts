import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityPostDocument {
  _id: ObjectId;
  communityId: ObjectId;
  authorUserId: ObjectId;
  body: string;
  mediaIds: ObjectId[];
  commentCount: number;
  reactionCounts: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
  removedByUserId?: ObjectId;
}

export function getCommunityPostsCollection() {
  return getDatabase().collection<CommunityPostDocument>('community_posts');
}

export async function createCommunityPostIndexes() {
  const collection = getCommunityPostsCollection();
  await collection.createIndex({ communityId: 1, createdAt: -1 });
  await collection.createIndex({ authorUserId: 1, createdAt: -1 });
  await collection.createIndex({ mediaIds: 1 }, { sparse: true });
}
