import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface PasswordResetTokenDocument {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  used: boolean;
}

export function getPasswordResetTokensCollection(): Collection<PasswordResetTokenDocument> {
  const db = getDatabase();
  return db.collection<PasswordResetTokenDocument>('passwordResetTokens');
}

export async function createPasswordResetTokenIndexes(): Promise<void> {
  const collection = getPasswordResetTokensCollection();

  // Create index on userId
  await collection.createIndex({ userId: 1 });

  // Create TTL index on expiresAt
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
