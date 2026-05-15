import { Collection, ObjectId } from 'mongodb';
import type { ChatIntelligenceSummary } from '@repo/types';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface ChatSummaryDocument {
  _id: ObjectId;
  chatId: ObjectId;
  generatedByUserId: ObjectId;
  summary: ChatIntelligenceSummary;
  createdAt: Date;
  updatedAt: Date;
}

export function getChatSummariesCollection(): Collection<ChatSummaryDocument> {
  const db = getDatabase();
  return db.collection<ChatSummaryDocument>('chat_summaries');
}

export async function createChatSummaryIndexes(): Promise<void> {
  const collection = getChatSummariesCollection();

  try {
    await collection.createIndex({ chatId: 1, createdAt: -1 }, { name: 'chatId_createdAt' });
    await collection.createIndex({ generatedByUserId: 1, createdAt: -1 }, { name: 'generatedBy_createdAt' });
    logger.info('Chat summary indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create chat summary indexes');
    throw error;
  }
}