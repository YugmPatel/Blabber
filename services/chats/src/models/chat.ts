import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface Chat {
  _id: ObjectId;
  type: 'direct' | 'group';
  participants: ObjectId[];
  admins: ObjectId[];
  title?: string;
  avatarUrl?: string;
  lastMessageRef?: {
    messageId: ObjectId;
    body: string;
    senderId: ObjectId;
    createdAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export function getChatsCollection() {
  const db = getDatabase();
  return db.collection<Chat>('chats');
}

export async function createChatIndexes(): Promise<void> {
  const collection = getChatsCollection();

  try {
    // Index on participants for filtering chats by user
    await collection.createIndex({ participants: 1 });

    // Index on updatedAt for sorting chat list
    await collection.createIndex({ updatedAt: -1 });

    logger.info('Chat indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create chat indexes');
    throw error;
  }
}
