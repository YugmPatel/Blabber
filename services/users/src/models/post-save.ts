import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export interface PostSaveDocument {
  _id: ObjectId;
  userId: ObjectId;
  postId: ObjectId;
  createdAt: Date;
}

export function getPostSavesCollection(): Collection<PostSaveDocument> {
  return getDatabase().collection<PostSaveDocument>('post_saves');
}

export async function createPostSaveIndexes(): Promise<void> {
  const collection = getPostSavesCollection();
  try {
    await collection.createIndex({ userId: 1, postId: 1 }, { unique: true, name: 'post_save_identity' });
    await collection.createIndex({ userId: 1, createdAt: -1 }, { name: 'post_save_user_created' });
    await collection.createIndex({ postId: 1 }, { name: 'post_save_post' });
    logger.info('Post save indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create post save indexes');
    throw error;
  }
}
