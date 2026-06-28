import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface SavedMessageDocument {
  _id?: ObjectId;
  userId: ObjectId;
  chatId: ObjectId;
  messageId: ObjectId;
  savedAt: Date;
}

export function getSavedMessagesCollection() {
  return getDatabase().collection<SavedMessageDocument>('savedMessages');
}

export async function createSavedMessageIndexes(): Promise<void> {
  const collection = getSavedMessagesCollection();
  await collection.createIndex({ userId: 1, savedAt: -1 }, { name: 'user_saved_at' });
  await collection.createIndex({ userId: 1, messageId: 1 }, { unique: true, name: 'user_message_save_unique' });
  await collection.createIndex({ chatId: 1, messageId: 1 }, { name: 'chat_saved_message' });
  logger.info('Saved message indexes created successfully');
}
