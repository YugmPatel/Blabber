import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export interface PostCommentDocument {
  _id: ObjectId;
  postId: ObjectId;
  postAuthorUserId: ObjectId;
  authorUserId: ObjectId;
  body: string;
  createdAt: Date;
  deletedAt?: Date;
  deletedByUserId?: ObjectId;
}

export function getPostCommentsCollection(): Collection<PostCommentDocument> {
  return getDatabase().collection<PostCommentDocument>('post_comments');
}

export async function createPostCommentIndexes(): Promise<void> {
  const collection = getPostCommentsCollection();
  try {
    await collection.createIndex({ postId: 1, deletedAt: 1, createdAt: 1, _id: 1 }, { name: 'post_comments_order' });
    await collection.createIndex({ authorUserId: 1, createdAt: -1 }, { name: 'author_createdAt' });
    await collection.createIndex({ postAuthorUserId: 1, createdAt: -1 }, { name: 'post_author_createdAt' });
    logger.info('Post comment indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create post comment indexes');
    throw error;
  }
}
