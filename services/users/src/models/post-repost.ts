import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export interface PostRepostDocument {
  _id: ObjectId;
  userId: ObjectId;
  postId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function getPostRepostsCollection(): Collection<PostRepostDocument> {
  return getDatabase().collection<PostRepostDocument>('post_reposts');
}

export async function createPostRepostIndexes(): Promise<void> {
  const collection = getPostRepostsCollection();
  try {
    await collection.createIndex({ userId: 1, postId: 1 }, { unique: true, name: 'post_repost_identity' });
    await collection.createIndex({ userId: 1, createdAt: -1, _id: -1 }, { name: 'post_repost_user_created' });
    await collection.createIndex({ postId: 1 }, { name: 'post_repost_post' });
    logger.info('Post repost indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create post repost indexes');
    throw error;
  }
}
