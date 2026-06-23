import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  clientMessageId?: string;
  type?: 'text' | 'image' | 'audio' | 'document' | 'poll' | 'sticker' | 'event';
  body: string;
  media?: {
    type: 'image' | 'audio' | 'document';
    url: string;
    mediaId?: ObjectId;
    storageKey?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    duration?: number;
    thumbnailUrl?: string;
  };
  poll?: {
    question: string;
    options: Array<{
      id: string;
      text: string;
      votes: ObjectId[];
    }>;
    allowMultiple?: boolean;
    closed?: boolean;
  };
  sticker?: {
    emoji: string;
    label?: string;
  };
  event?: {
    title: string;
    startsAt: string;
    location?: string;
    description?: string;
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

    await collection.createIndex(
      { chatId: 1, senderId: 1, clientMessageId: 1 },
      {
        name: 'chat_sender_clientMessageId',
        unique: true,
        partialFilterExpression: { clientMessageId: { $exists: true } },
      }
    );

    logger.info('Message indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create message indexes');
    throw error;
  }
}
