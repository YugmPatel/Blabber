import { Collection, ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { getDatabase } from '../db';

export interface DeviceSessionDocument {
  _id: ObjectId;
  userId: ObjectId;
  refreshTokenHash: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: Date;
  createdAt: Date;
  lastActiveAt?: Date;
  revokedAt?: Date;
}

export function getDeviceSessionsCollection(): Collection<DeviceSessionDocument> {
  const db = getDatabase();
  return db.collection<DeviceSessionDocument>('deviceSessions');
}

function digestRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

export async function hashRefreshToken(refreshToken: string): Promise<string> {
  return bcrypt.hash(digestRefreshToken(refreshToken), 10);
}

export async function compareRefreshToken(refreshToken: string, refreshTokenHash: string): Promise<boolean> {
  return bcrypt.compare(digestRefreshToken(refreshToken), refreshTokenHash);
}

export async function createDeviceSessionIndexes(): Promise<void> {
  const collection = getDeviceSessionsCollection();

  // Create index on userId
  await collection.createIndex({ userId: 1 });

  // Create TTL index on expiresAt
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
