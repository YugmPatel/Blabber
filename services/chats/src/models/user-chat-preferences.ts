import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface UserChatPreferences {
  _id: ObjectId;
  userId: ObjectId;
  chatId: ObjectId;
  pinned: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function getUserChatPreferencesCollection() {
  const db = getDatabase();
  return db.collection<UserChatPreferences>('userChatPreferences');
}

export async function createUserChatPreferencesIndexes(): Promise<void> {
  const collection = getUserChatPreferencesCollection();

  try {
    // Compound unique index on userId and chatId
    await collection.createIndex({ userId: 1, chatId: 1 }, { unique: true });

    // Index on userId for querying user's preferences
    await collection.createIndex({ userId: 1 });

    logger.info('User chat preferences indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create user chat preferences indexes');
    throw error;
  }
}
