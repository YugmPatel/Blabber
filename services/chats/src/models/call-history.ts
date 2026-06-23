import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export type CallOutcome = 'ringing' | 'answered' | 'missed' | 'declined' | 'cancelled' | 'ended';

export interface CallHistoryDocument {
  _id: ObjectId;
  callId: string;
  chatId: ObjectId;
  chatType: 'direct' | 'group';
  callType: 'audio' | 'video';
  callerId: ObjectId;
  participantIds: ObjectId[];
  outcome: CallOutcome;
  startedAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function getCallHistoryCollection(): Collection<CallHistoryDocument> {
  return getDatabase().collection<CallHistoryDocument>('call_history');
}

export async function createCallHistoryIndexes(): Promise<void> {
  try {
    const collection = getCallHistoryCollection();
    await collection.createIndex({ callId: 1 }, { unique: true, name: 'callId_unique' });
    await collection.createIndex({ participantIds: 1, startedAt: -1 }, { name: 'participant_startedAt' });
    await collection.createIndex({ chatId: 1, startedAt: -1 }, { name: 'chat_startedAt' });
    logger.info('Call history indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create call history indexes');
    throw error;
  }
}
