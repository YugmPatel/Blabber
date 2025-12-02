import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface DeviceSessionDocument {
  _id: ObjectId;
  userId: ObjectId;
  refreshTokenHash: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: Date;
  createdAt: Date;
}

export function getDeviceSessionsCollection(): Collection<DeviceSessionDocument> {
  const db = getDatabase();
  return db.collection<DeviceSessionDocument>('deviceSessions');
}

export async function createDeviceSessionIndexes(): Promise<void> {
  const collection = getDeviceSessionsCollection();

  // Create index on userId
  await collection.createIndex({ userId: 1 });

  // Create TTL index on expiresAt
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
