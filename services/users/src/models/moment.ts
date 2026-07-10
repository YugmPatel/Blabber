import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export type MomentType = 'text' | 'image' | 'audio' | 'video';
export type MomentAudienceType = 'contacts' | 'contacts_except' | 'only_share_with' | 'close_friends';
export type MomentArchiveState = 'active' | 'archived' | 'deleted';

export interface MomentDocument {
  _id: ObjectId;
  authorUserId: ObjectId;
  type: MomentType;
  textBody?: string;
  caption?: string;
  mediaId?: ObjectId;
  videoId?: ObjectId;
  style?: {
    backgroundKey?: string;
    textStyleKey?: string;
  };
  audienceType: MomentAudienceType;
  audienceSnapshotUserIds: ObjectId[];
  createdAt: Date;
  expiresAt: Date;
  expiredAt?: Date;
  deletedAt?: Date;
  archiveState: MomentArchiveState;
}

export function getMomentsCollection(): Collection<MomentDocument> {
  return getDatabase().collection<MomentDocument>('moments');
}

export async function createMomentIndexes(): Promise<void> {
  const collection = getMomentsCollection();
  try {
    await collection.createIndex({ authorUserId: 1, archiveState: 1, createdAt: -1 }, { name: 'author_archive_createdAt' });
    await collection.createIndex({ audienceSnapshotUserIds: 1, archiveState: 1, expiresAt: 1 }, { name: 'audience_archive_expiresAt' });
    await collection.createIndex({ archiveState: 1, expiresAt: 1 }, { name: 'archive_expiresAt' });
    await collection.createIndex({ mediaId: 1 }, { sparse: true, name: 'mediaId' });
    await collection.createIndex({ videoId: 1 }, { sparse: true, name: 'videoId' });
    logger.info('Moment indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create Moment indexes');
    throw error;
  }
}
