import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface MessagePinDocument {
  _id?: ObjectId;
  chatId: ObjectId;
  messageId: ObjectId;
  pinnedBy: ObjectId;
  pinnedAt: Date;
  preview: {
    senderId: ObjectId;
    senderDisplayName: string;
    type?: string;
    snippet: string;
    attachmentLabel?: string;
    createdAt: Date;
  };
}

export function getMessagePinsCollection() {
  return getDatabase().collection<MessagePinDocument>('messagePins');
}

export async function createMessagePinIndexes(): Promise<void> {
  const collection = getMessagePinsCollection();
  await collection.createIndex({ chatId: 1, pinnedAt: -1 }, { name: 'chat_pins' });
  await collection.createIndex({ chatId: 1, messageId: 1 }, { unique: true, name: 'chat_message_pin_unique' });
  logger.info('Message pin indexes created successfully');
}
