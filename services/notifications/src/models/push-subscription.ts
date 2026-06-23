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
  updatedAt?: Date;
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

export async function upsertPushSubscription(
  subscription: Omit<PushSubscription, '_id' | 'createdAt' | 'updatedAt'>
): Promise<PushSubscription> {
  const db = getDatabase();
  const collection = db.collection<PushSubscription>('pushSubscriptions');
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId: subscription.userId,
        keys: subscription.keys,
        userAgent: subscription.userAgent,
        updatedAt: now,
      },
      $setOnInsert: {
        endpoint: subscription.endpoint,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  if (!result) {
    throw new Error('Failed to upsert push subscription');
  }

  return result;
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
