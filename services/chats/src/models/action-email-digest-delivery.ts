import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type ActionEmailDigestDeliveryStatus = 'pending' | 'sent' | 'skipped' | 'failed';

export interface ActionEmailDigestDeliveryDocument {
  _id?: ObjectId;
  userId: ObjectId;
  localDate: string;
  timezone: string;
  scheduledHour: number;
  status: ActionEmailDigestDeliveryStatus;
  count: number;
  sentAt?: Date;
  errorCategory?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function getActionEmailDigestDeliveriesCollection(): Collection<ActionEmailDigestDeliveryDocument> {
  return getDatabase().collection<ActionEmailDigestDeliveryDocument>('actionEmailDigestDeliveries');
}

export async function createActionEmailDigestDeliveryIndexes(): Promise<void> {
  const collection = getActionEmailDigestDeliveriesCollection();
  await collection.createIndex({ userId: 1, localDate: 1 }, { unique: true, name: 'action_digest_user_localDate' });
  await collection.createIndex({ status: 1, updatedAt: -1 }, { name: 'action_digest_status_updatedAt' });
}
