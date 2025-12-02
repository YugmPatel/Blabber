import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface UserDocument {
  _id: ObjectId;
  username: string;
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl?: string;
  about?: string;
  contacts: ObjectId[];
  blocked: ObjectId[];
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getUsersCollection(): Collection<UserDocument> {
  const db = getDatabase();
  return db.collection<UserDocument>('users');
}

export async function createUserIndexes(): Promise<void> {
  const collection = getUsersCollection();

  // Create unique index on username
  await collection.createIndex({ username: 1 }, { unique: true });

  // Create unique index on email
  await collection.createIndex({ email: 1 }, { unique: true });

  // Create text index for search - skip if already exists with different name
  try {
    await collection.createIndex(
      { username: 'text', name: 'text' },
      { name: 'username_text_name_text' }
    );
  } catch (error: any) {
    if (error.code === 85) {
      // Index already exists with different name, skip it
      console.log('Text index already exists, skipping creation');
    } else {
      throw error;
    }
  }
}
