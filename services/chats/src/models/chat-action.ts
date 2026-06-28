import { Collection, ObjectId } from 'mongodb';
import type {
  ChatActionActivity,
  ChatActionPerson,
  ChatActionPriority,
  ChatActionStatus,
  ChatActionType,
  ChatActionUpdate,
  ChatActionVisibility,
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
  dueAt?: Date;
  eventStart?: string;
  eventEnd?: string;
  status: ChatActionStatus;
  priority?: ChatActionPriority;
  visibility?: ChatActionVisibility;
  personalOwnerUserId?: ObjectId;
  confidence?: number;
  sourceMessageIds: ObjectId[];
  sourceText?: string;
  updates?: ChatActionUpdate[];
  activity?: ChatActionActivity[];
  completedAt?: Date;
  completedBy?: ChatActionPerson;
  lastActivityAt?: Date;
  metadata?: Record<string, unknown>;
  deletedAt?: Date;
  deletedBy?: ChatActionPerson;
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
    await collection.createIndex({ 'createdBy.userId': 1, status: 1 }, { name: 'createdBy_status' });
    await collection.createIndex({ visibility: 1, personalOwnerUserId: 1, status: 1 }, { name: 'visibility_personalOwner_status' });
    await collection.createIndex({ status: 1, dueAt: 1 }, { name: 'status_dueAt' });
    await collection.createIndex({ lastActivityAt: -1 }, { name: 'lastActivityAt' });
    await collection.createIndex({ deletedAt: 1 }, { name: 'deletedAt', sparse: true });
    await collection.createIndex({ chatId: 1, actionKey: 1 }, { name: 'chatId_actionKey' });
    await collection.createIndex({ sourceMessageIds: 1 }, { name: 'sourceMessageIds' });
    logger.info('Chat action indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create chat action indexes');
    throw error;
  }
}
