import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityPostCommentDocument {
  _id: ObjectId;
  communityId: ObjectId;
  communityPostId: ObjectId;
  authorUserId: ObjectId;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  deletedByUserId?: ObjectId;
}

export function getCommunityPostCommentsCollection() {
  return getDatabase().collection<CommunityPostCommentDocument>('community_post_comments');
}

export async function createCommunityPostCommentIndexes() {
  const collection = getCommunityPostCommentsCollection();
  await collection.createIndex({ communityPostId: 1, createdAt: 1 });
  await collection.createIndex({ authorUserId: 1, createdAt: -1 });
}
