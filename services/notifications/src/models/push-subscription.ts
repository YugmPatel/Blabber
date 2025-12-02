import { getDatabase } from '../db';
import { ObjectId } from 'mongodb';

export interface PushSubscription {
  _id?: ObjectId;
  userId: ObjectId;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  createdAt: Date;
}

export async function createPushSubscriptionIndexes() {
  const db = getDatabase();
  const collection = db.collection<PushSubscription>('pushSubscriptions');

  // Index on userId for efficient lookups
  await collection.createIndex({ userId: 1 });

  // Unique index on endpoint to prevent duplicates
  await collection.createIndex({ endpoint: 1 }, { unique: true });
}

export async function createPushSubscription(
  subscription: Omit<PushSubscription, '_id' | 'createdAt'>
): Promise<PushSubscription> {
  const db = getDatabase();
  const collection = db.collection<PushSubscription>('pushSubscriptions');

  const doc: PushSubscription = {
    ...subscription,
    createdAt: new Date(),
  };

  const result = await collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function findPushSubscriptionsByUserId(userId: ObjectId): Promise<PushSubscription[]> {
  const db = getDatabase();
  const collection = db.collection<PushSubscription>('pushSubscriptions');

  return collection.find({ userId }).toArray();
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  const db = getDatabase();
  const collection = db.collection<PushSubscription>('pushSubscriptions');

  const result = await collection.deleteOne({ endpoint });
  return result.deletedCount > 0;
}

export async function deletePushSubscriptionById(id: ObjectId): Promise<boolean> {
  const db = getDatabase();
  const collection = db.collection<PushSubscription>('pushSubscriptions');

  const result = await collection.deleteOne({ _id: id });
  return result.deletedCount > 0;
}
