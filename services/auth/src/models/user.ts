import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface UserDocument {
  _id: ObjectId;
  username: string;
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl?: string;
  avatarSource?: 'google' | 'upload' | 'none';
  googleAvatarUrl?: string;
  about?: string;
  profileHandle?: string;
  profileBio?: string;
  profileWebsite?: string;
  profileVisibility?: 'private' | 'public';
  profileHandleChangedAt?: Date;
  profileUpdatedAt?: Date;
  role?: string;
  platformRole?: 'user' | 'moderator' | 'admin';
  department?: string;
  googleId?: string;
  authProvider?: 'password' | 'google' | 'both';
  emailVerified?: boolean;
  deactivatedAt?: Date;
  deletionScheduledAt?: Date;
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
  await collection.createIndex(
    { profileHandle: 1 },
    { unique: true, sparse: true, name: 'profile_handle_unique' }
  );

  // Create sparse unique index on Google subject for OAuth users
  await collection.createIndex({ googleId: 1 }, { unique: true, sparse: true });
  await collection.createIndex({ platformRole: 1 }, { sparse: true });

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
