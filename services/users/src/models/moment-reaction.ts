import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export const MOMENT_REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🙌'] as const;
export type MomentReactionEmoji = (typeof MOMENT_REACTION_EMOJIS)[number];

export interface MomentReactionDocument {
  _id: ObjectId;
  momentId: ObjectId;
  authorUserId: ObjectId;
  viewerUserId: ObjectId;
  emoji: MomentReactionEmoji;
  createdAt: Date;
  updatedAt: Date;
}

export function getMomentReactionsCollection(): Collection<MomentReactionDocument> {
  return getDatabase().collection<MomentReactionDocument>('moment_reactions');
}

export async function createMomentReactionIndexes(): Promise<void> {
  const collection = getMomentReactionsCollection();
  try {
    await collection.createIndex(
      { momentId: 1, viewerUserId: 1 },
      { unique: true, name: 'moment_viewer_unique' }
    );
    await collection.createIndex({ authorUserId: 1, updatedAt: -1 }, { name: 'author_updatedAt' });
    await collection.createIndex({ viewerUserId: 1, updatedAt: -1 }, { name: 'viewer_updatedAt' });
    logger.info('Moment reaction indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create moment reaction indexes');
    throw error;
  }
}
