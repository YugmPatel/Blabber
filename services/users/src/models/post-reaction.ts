import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export const POST_REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🙌'] as const;
export type PostReactionEmoji = (typeof POST_REACTION_EMOJIS)[number];

export interface PostReactionDocument {
  _id: ObjectId;
  postId: ObjectId;
  authorUserId: ObjectId;
  reactingUserId: ObjectId;
  emoji: PostReactionEmoji;
  createdAt: Date;
  updatedAt: Date;
}

export function getPostReactionsCollection(): Collection<PostReactionDocument> {
  return getDatabase().collection<PostReactionDocument>('post_reactions');
}

export async function createPostReactionIndexes(): Promise<void> {
  const collection = getPostReactionsCollection();
  try {
    await collection.createIndex({ postId: 1, reactingUserId: 1 }, { unique: true, name: 'post_reacting_user_unique' });
    await collection.createIndex({ authorUserId: 1, updatedAt: -1 }, { name: 'author_updatedAt' });
    await collection.createIndex({ reactingUserId: 1, updatedAt: -1 }, { name: 'reacting_updatedAt' });
    logger.info('Post reaction indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create post reaction indexes');
    throw error;
  }
}
