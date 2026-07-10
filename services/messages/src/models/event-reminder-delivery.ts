import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type EventReminderType = 'five_minutes_before' | 'fifteen_minutes_before' | 'hour_before' | 'day_before';
export type EventReminderDeliveryStatus = 'pending' | 'sent' | 'skipped' | 'failed';

export interface EventReminderDeliveryDocument {
  _id?: ObjectId;
  eventId: ObjectId;
  userId: ObjectId;
  reminderType: EventReminderType;
  reminderWindowKey: string;
  eventScheduleVersion: string;
  status: EventReminderDeliveryStatus;
  attemptedAt?: Date;
  sentAt?: Date;
  skippedReason?: string;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function getEventReminderDeliveriesCollection(): Collection<EventReminderDeliveryDocument> {
  return getDatabase().collection<EventReminderDeliveryDocument>('event_reminder_deliveries');
}

export async function createEventReminderDeliveryIndexes() {
  await getEventReminderDeliveriesCollection().createIndex(
    { eventId: 1, userId: 1, reminderType: 1, reminderWindowKey: 1, eventScheduleVersion: 1 },
    { unique: true, name: 'event_reminder_idempotency' }
  );
}

export async function reserveEventReminderDelivery(
  delivery: Omit<EventReminderDeliveryDocument, '_id' | 'status' | 'createdAt' | 'updatedAt'>
) {
  const now = new Date();
  const { attemptedAt: _attemptedAt, ...insertDelivery } = delivery;
  const result = await getEventReminderDeliveriesCollection().findOneAndUpdate(
    {
      eventId: delivery.eventId,
      userId: delivery.userId,
      reminderType: delivery.reminderType,
      reminderWindowKey: delivery.reminderWindowKey,
      eventScheduleVersion: delivery.eventScheduleVersion,
    },
    {
      $setOnInsert: {
        ...insertDelivery,
        status: 'pending',
        createdAt: now,
      },
      $set: {
        updatedAt: now,
        attemptedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return result?.status === 'pending' ? result : null;
}

export async function markEventReminderDelivery(
  id: ObjectId,
  status: EventReminderDeliveryStatus,
  details: Pick<EventReminderDeliveryDocument, 'skippedReason' | 'errorCode'> = {}
) {
  const now = new Date();
  await getEventReminderDeliveriesCollection().updateOne(
    { _id: id },
    {
      $set: {
        status,
        ...details,
        sentAt: status === 'sent' ? now : undefined,
        updatedAt: now,
      },
    }
  );
}
