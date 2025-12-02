import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  body: string;
  media?: {
    type: 'image' | 'audio' | 'document';
    url: string;
    duration?: number;
    thumbnailUrl?: string;
  };
  replyTo?: {
    messageId: ObjectId;
    body: string;
    senderId: ObjectId;
  };
  reactions: Array<{
    userId: ObjectId;
    emoji: string;
    createdAt: Date;
  }>;
  status: 'sent' | 'delivered' | 'read';
  deletedFor: ObjectId[];
  createdAt: Date;
  editedAt?: Date;
}

export function getMessagesCollection(): Collection<MessageDocument> {
  const db = getDatabase();
  return db.collection<MessageDocument>('messages');
}

export async function createMessageIndexes(): Promise<void> {
  const collection = getMessagesCollection();

  try {
    // Compound index for efficient pagination by chat
    await collection.createIndex({ chatId: 1, createdAt: -1 }, { name: 'chatId_createdAt' });

    // Index for sender queries
    await collection.createIndex({ senderId: 1 }, { name: 'senderId' });

    logger.info('Message indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create message indexes');
    throw error;
  }
}
