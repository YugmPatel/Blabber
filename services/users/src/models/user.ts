import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface User {
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

export function getUsersCollection() {
  const db = getDatabase();
  return db.collection<User>('users');
}

export async function createUserIndexes(): Promise<void> {
  const collection = getUsersCollection();

  try {
    // Unique index on username
    await collection.createIndex({ username: 1 }, { unique: true });

    // Unique index on email
    await collection.createIndex({ email: 1 }, { unique: true });

    // Text index on username and name for search
    await collection.createIndex({ username: 'text', name: 'text' }, { name: 'user_search_text' });

    logger.info('User indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create user indexes');
    throw error;
  }
}

export async function findUserById(userId: string | ObjectId): Promise<User | null> {
  const collection = getUsersCollection();
  const _id = typeof userId === 'string' ? new ObjectId(userId) : userId;
  return collection.findOne({ _id });
}

export async function searchUsersByText(
  query: string,
  excludeUserIds: ObjectId[] = []
): Promise<User[]> {
  const collection = getUsersCollection();

  const results = await collection
    .find({
      $text: { $search: query },
      _id: { $nin: excludeUserIds },
    })
    .project({
      passwordHash: 0,
    })
    .limit(20)
    .toArray();

  return results as User[];
}

export async function updateUserProfile(
  userId: string | ObjectId,
  updates: Partial<Pick<User, 'name' | 'avatarUrl' | 'about'>>
): Promise<User | null> {
  const collection = getUsersCollection();
  const _id = typeof userId === 'string' ? new ObjectId(userId) : userId;

  const result = await collection.findOneAndUpdate(
    { _id },
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  return result;
}

export async function addBlockedUser(
  userId: string | ObjectId,
  blockedUserId: string | ObjectId
): Promise<void> {
  const collection = getUsersCollection();
  const _id = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const blockedId = typeof blockedUserId === 'string' ? new ObjectId(blockedUserId) : blockedUserId;

  await collection.updateOne(
    { _id },
    {
      $addToSet: { blocked: blockedId },
      $set: { updatedAt: new Date() },
    }
  );
}

export async function removeBlockedUser(
  userId: string | ObjectId,
  blockedUserId: string | ObjectId
): Promise<void> {
  const collection = getUsersCollection();
  const _id = typeof userId === 'string' ? new ObjectId(userId) : userId;
  const blockedId = typeof blockedUserId === 'string' ? new ObjectId(blockedUserId) : blockedUserId;

  await collection.updateOne(
    { _id },
    {
      $pull: { blocked: blockedId },
      $set: { updatedAt: new Date() },
    }
  );
}
