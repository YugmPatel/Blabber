import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type MessageRequestStatus = 'pending' | 'accepted' | 'declined';

export interface MessageRequestDocument {
  _id: ObjectId;
  senderId: ObjectId;
  recipientId: ObjectId;
  status: MessageRequestStatus;
  introMessage?: string;
  chatId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  respondedAt?: Date;
}

export function getMessageRequestsCollection(): Collection<MessageRequestDocument> {
  return getDatabase().collection<MessageRequestDocument>('message_requests');
}

export async function createMessageRequestIndexes(): Promise<void> {
  const collection = getMessageRequestsCollection();
  await collection.createIndex(
    { recipientId: 1, status: 1, createdAt: -1 },
    { name: 'message_request_inbox' }
  );
  await collection.createIndex(
    { senderId: 1, status: 1, createdAt: -1 },
    { name: 'message_request_sent' }
  );
  // A sender may have at most one pending request to a given recipient at a
  // time; this is what actually enforces "no duplicate pending requests" at
  // the data layer, not just in application code.
  await collection.createIndex(
    { senderId: 1, recipientId: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' }, name: 'message_request_pending_unique' }
  );
}
