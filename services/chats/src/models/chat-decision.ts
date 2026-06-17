import { Collection, ObjectId } from 'mongodb';
import type {
  ChatDecisionCategory,
  ChatDecisionPerson,
  ChatDecisionStatus,
} from '@repo/types';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export interface ChatDecisionDocument {
  _id: ObjectId;
  chatId: ObjectId;
  decisionKey: string;
  title: string;
  description?: string;
  status: ChatDecisionStatus;
  decidedBy?: ChatDecisionPerson[];
  decidedAt?: string;
  confidence?: number;
  sourceMessageIds: ObjectId[];
  sourceText?: string;
  relatedActionIds?: ObjectId[];
  category?: ChatDecisionCategory;
  metadata?: Record<string, unknown>;
  generatedByUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function getChatDecisionsCollection(): Collection<ChatDecisionDocument> {
  return getDatabase().collection<ChatDecisionDocument>('chat_decisions');
}

export async function createChatDecisionIndexes(): Promise<void> {
  const collection = getChatDecisionsCollection();

  try {
    await collection.createIndex({ chatId: 1, createdAt: -1 }, { name: 'chatId_createdAt' });
    await collection.createIndex({ chatId: 1, status: 1 }, { name: 'chatId_status' });
    await collection.createIndex({ chatId: 1, title: 1 }, { name: 'chatId_title' });
    await collection.createIndex({ chatId: 1, decisionKey: 1 }, { name: 'chatId_decisionKey' });
    await collection.createIndex({ sourceMessageIds: 1 }, { name: 'sourceMessageIds' });
    logger.info('Chat decision indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create chat decision indexes');
    throw error;
  }
}
