import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface User {
  _id: ObjectId;
  username: string;
  email: string;
  emailVerified?: boolean;
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
  creatorDiscoveryEnabled?: boolean;
  creatorTopicIds?: string[];
  creatorDiscoveryEnabledAt?: Date;
  creatorDiscoveryUpdatedAt?: Date;
  // Absent means true — discovery content visibility is opt-out.
  discoveryShowPosts?: boolean;
  discoveryShowReels?: boolean;
  // Absent means true — appear in suggested-creator recommendations.
  discoverySuggestEnabled?: boolean;
  // Absent means 'everyone'.
  usernameFindability?: 'everyone' | 'followers' | 'contacts' | 'no_one';
  // Absent means true — hide users I blocked from my Discover and search.
  discoveryHideBlocked?: boolean;
  role?: string;
  platformRole?: 'user' | 'moderator' | 'admin';
  department?: string;
  contacts: ObjectId[];
  blocked: ObjectId[];
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt?: Date;
  deletedAt?: Date;
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
    await collection.createIndex(
      { profileHandle: 1 },
      { unique: true, sparse: true, name: 'profile_handle_unique' }
    );
    await collection.createIndex({ platformRole: 1 }, { sparse: true });
    await collection.createIndex(
      { creatorDiscoveryEnabled: 1, profileVisibility: 1, creatorDiscoveryEnabledAt: -1 },
      { name: 'creator_discovery_browse' }
    );

    // Text index on username and name for search. MongoDB rejects creating the
    // same text index under a new name, so reuse an equivalent existing index.
    const indexes = await collection.indexes();
    const hasSearchTextIndex = indexes.some(
      (index) => index.key?._fts === 'text' && index.weights?.username && index.weights?.name
    );

    if (!hasSearchTextIndex) {
      await collection.createIndex({ username: 'text', name: 'text' }, { name: 'user_search_text' });
    }

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
  excludeUserIds: ObjectId[] = [],
  options: { limit?: number; after?: ObjectId | null } = {}
): Promise<User[]> {
  const collection = getUsersCollection();
  const limit = Math.min(21, Math.max(1, options.limit ?? 20));

  const filter: Record<string, unknown> = {
    $text: { $search: query },
    _id: options.after ? { $nin: excludeUserIds, $gt: options.after } : { $nin: excludeUserIds },
    deactivatedAt: { $exists: false },
    deletedAt: { $exists: false },
  };

  const results = await collection
    .find(filter)
    .project({
      passwordHash: 0,
    })
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();

  return results as User[];
}

export async function updateUserProfile(
  userId: string | ObjectId,
  updates: Partial<Pick<User, 'name' | 'avatarUrl' | 'about' | 'role' | 'department' | 'avatarSource'>>
): Promise<User | null> {
  const collection = getUsersCollection();
  const _id = typeof userId === 'string' ? new ObjectId(userId) : userId;

  const existing = await collection.findOne({ _id });
  if (!existing) return null;

  const setUpdates: Partial<User> & { updatedAt: Date } = {
    ...updates,
    updatedAt: new Date(),
  };
  const unsetUpdates: Record<string, ''> = {};

  if ('avatarUrl' in updates) {
    if (updates.avatarUrl) {
      setUpdates.avatarSource = updates.avatarSource ?? 'upload';
    } else if (existing.googleAvatarUrl) {
      setUpdates.avatarUrl = existing.googleAvatarUrl;
      setUpdates.avatarSource = 'google';
    } else {
      delete setUpdates.avatarUrl;
      setUpdates.avatarSource = 'none';
      unsetUpdates.avatarUrl = '';
    }
  }

  const update: any = { $set: setUpdates };
  if (Object.keys(unsetUpdates).length > 0) {
    update.$unset = unsetUpdates;
  }

  const result = await collection.findOneAndUpdate({ _id }, update, { returnDocument: 'after' });

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
