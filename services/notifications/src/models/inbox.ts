import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface NotificationInboxItem {
  _id: ObjectId;
  userId: ObjectId;
  kind: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  readAt?: Date;
  createdAt: Date;
}

export function getNotificationInboxCollection() {
  return getDatabase().collection<NotificationInboxItem>('notifications');
}

export async function createNotificationInboxIndexes() {
  const collection = getNotificationInboxCollection();
  await collection.createIndex({ userId: 1, createdAt: -1 });
  await collection.createIndex({ userId: 1, readAt: 1, createdAt: -1 });
}

export async function recordNotificationInboxItem(input: {
  userId: ObjectId;
  kind: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}) {
  const now = new Date();
  const item: NotificationInboxItem = {
    _id: new ObjectId(),
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    data: input.data || {},
    createdAt: now,
  };
  await getNotificationInboxCollection().insertOne(item);
  return item;
}

export function serializeNotificationInboxItem(item: NotificationInboxItem) {
  return {
    _id: item._id.toString(),
    kind: item.kind,
    title: item.title,
    body: item.body,
    data: item.data || {},
    readAt: item.readAt?.toISOString(),
    createdAt: item.createdAt.toISOString(),
  };
}
