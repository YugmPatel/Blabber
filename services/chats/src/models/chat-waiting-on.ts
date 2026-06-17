import { Collection, ObjectId } from 'mongodb';
import type {
  ChatActionPriority,
  WaitingOnDirection,
  WaitingOnPerson,
  WaitingOnStatus,
} from '@repo/types';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export interface WaitingOnDocument {
  _id: ObjectId;
  chatId: ObjectId;
  waitingOnKey: string;
  direction: WaitingOnDirection;
  title: string;
  description?: string;
  person?: WaitingOnPerson;
  requester?: WaitingOnPerson;
  owner?: WaitingOnPerson;
  status: WaitingOnStatus;
  priority?: ChatActionPriority;
  dueDate?: string;
  confidence?: number;
  sourceMessageIds: ObjectId[];
  sourceText?: string;
  relatedActionIds?: ObjectId[];
  generatedByUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function getWaitingOnCollection(): Collection<WaitingOnDocument> {
  return getDatabase().collection<WaitingOnDocument>('chat_waiting_on');
}

export async function createWaitingOnIndexes(): Promise<void> {
  const collection = getWaitingOnCollection();

  try {
    await collection.createIndex({ chatId: 1, createdAt: -1 }, { name: 'chatId_createdAt' });
    await collection.createIndex({ chatId: 1, status: 1 }, { name: 'chatId_status' });
    await collection.createIndex({ direction: 1, status: 1 }, { name: 'direction_status' });
    await collection.createIndex({ 'person.userId': 1, status: 1 }, { name: 'person_status' });
    await collection.createIndex({ 'owner.userId': 1, status: 1 }, { name: 'owner_status' });
    await collection.createIndex({ chatId: 1, waitingOnKey: 1 }, { name: 'chatId_waitingOnKey' });
    await collection.createIndex({ sourceMessageIds: 1 }, { name: 'sourceMessageIds' });
    logger.info('Waiting-on indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create waiting-on indexes');
    throw error;
  }
}
