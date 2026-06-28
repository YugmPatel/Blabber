import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type ActionReminderType = 'due_tomorrow' | 'due_today' | 'overdue' | 'stale';
export type ActionReminderDeliveryStatus = 'pending' | 'sent' | 'skipped' | 'failed';

export interface ActionReminderDeliveryDocument {
  _id?: ObjectId;
  actionId: ObjectId;
  userId: ObjectId;
  reminderType: ActionReminderType;
  reminderWindowKey: string;
  dueDateVersion: string;
  status: ActionReminderDeliveryStatus;
  attemptedAt?: Date;
  sentAt?: Date;
  skippedReason?: string;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function getActionReminderDeliveriesCollection(): Collection<ActionReminderDeliveryDocument> {
  return getDatabase().collection<ActionReminderDeliveryDocument>('action_reminder_deliveries');
}

export async function createActionReminderDeliveryIndexes(): Promise<void> {
  const collection = getActionReminderDeliveriesCollection();
  await collection.createIndex(
    { actionId: 1, userId: 1, reminderType: 1, reminderWindowKey: 1, dueDateVersion: 1 },
    { unique: true, name: 'action_user_type_window_version_unique' }
  );
  await collection.createIndex({ status: 1, updatedAt: -1 }, { name: 'status_updatedAt' });
  await collection.createIndex({ actionId: 1, reminderType: 1, dueDateVersion: 1 }, { name: 'action_type_version' });
}
