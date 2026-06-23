import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface ChatReadState {
  _id?: ObjectId;
  userId: ObjectId;
  chatId: ObjectId;
  lastReadAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getChatReadStatesCollection() {
  return getDatabase().collection<ChatReadState>('chatReadStates');
}

export async function createChatReadStateIndexes(): Promise<void> {
  const collection = getChatReadStatesCollection();

  try {
    await collection.createIndex({ userId: 1, chatId: 1 }, { unique: true });
    await collection.createIndex({ chatId: 1, lastReadAt: -1 });
    logger.info('Chat read state indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create chat read state indexes');
    throw error;
  }
}
