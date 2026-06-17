import { Collection, ObjectId } from 'mongodb';
import type {
  ChatActionPerson,
  ChatActionPriority,
  ChatActionStatus,
  ChatActionType,
} from '@repo/types';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export interface ChatActionDocument {
  _id: ObjectId;
  chatId: ObjectId;
  actionKey: string;
  type: ChatActionType;
  title: string;
  description?: string;
  assignedTo?: ChatActionPerson;
  createdBy?: ChatActionPerson;
  dueDate?: string;
  eventStart?: string;
  eventEnd?: string;
  status: ChatActionStatus;
  priority?: ChatActionPriority;
  confidence?: number;
  sourceMessageIds: ObjectId[];
  sourceText?: string;
  metadata?: Record<string, unknown>;
  generatedByUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function getChatActionsCollection(): Collection<ChatActionDocument> {
  return getDatabase().collection<ChatActionDocument>('chat_actions');
}

export async function createChatActionIndexes(): Promise<void> {
  const collection = getChatActionsCollection();

  try {
    await collection.createIndex({ chatId: 1, createdAt: -1 }, { name: 'chatId_createdAt' });
    await collection.createIndex({ chatId: 1, status: 1 }, { name: 'chatId_status' });
    await collection.createIndex({ 'assignedTo.userId': 1, status: 1 }, { name: 'assignedTo_status' });
    await collection.createIndex({ chatId: 1, actionKey: 1 }, { name: 'chatId_actionKey' });
    await collection.createIndex({ sourceMessageIds: 1 }, { name: 'sourceMessageIds' });
    logger.info('Chat action indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create chat action indexes');
    throw error;
  }
}
