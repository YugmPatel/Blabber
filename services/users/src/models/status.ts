import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface StatusDocument {
  _id: ObjectId;
  userId: ObjectId;
  type: 'text' | 'image';
  content: string;
  backgroundColor?: string;
  mediaUrl?: string;
  createdAt: Date;
  expiresAt: Date;
}

export function getStatusesCollection(): Collection<StatusDocument> {
  return getDatabase().collection<StatusDocument>('statuses');
}

export async function createStatusIndexes(): Promise<void> {
  const collection = getStatusesCollection();

  try {
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' });
    await collection.createIndex({ userId: 1, createdAt: -1 }, { name: 'userId_createdAt' });
    logger.info('Status indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create status indexes');
    throw error;
  }
}
