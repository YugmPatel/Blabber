import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export type PostVisibility = 'public' | 'followers';

export interface PostDocument {
  _id: ObjectId;
  authorUserId: ObjectId;
  body?: string;
  visibility: PostVisibility;
  mediaIds: ObjectId[];
  commentCount: number;
  reactionCounts: Record<string, number>;
  discoverable?: boolean;
  discoveryTopicIds?: string[];
  discoverableUpdatedAt?: Date;
  importer?: {
    provider?: string;
    providerCreatorName?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
}

export function getPostsCollection(): Collection<PostDocument> {
  return getDatabase().collection<PostDocument>('posts');
}

export async function createPostIndexes(): Promise<void> {
  const collection = getPostsCollection();
  try {
    await collection.createIndex(
      { authorUserId: 1, deletedAt: 1, createdAt: -1, _id: -1 },
      { name: 'author_deleted_created' }
    );
    await collection.createIndex(
      { deletedAt: 1, createdAt: -1, _id: -1 },
      { name: 'feed_deleted_created' }
    );
    await collection.createIndex({ mediaIds: 1 }, { name: 'mediaIds' });
    await collection.createIndex(
      { discoverable: 1, visibility: 1, deletedAt: 1, createdAt: -1, _id: -1 },
      { name: 'post_discovery_browse' }
    );
    await collection.createIndex({ discoveryTopicIds: 1, discoverable: 1 }, { name: 'post_discovery_topics' });
    logger.info('Post indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create post indexes');
    throw error;
  }
}
