import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Who is allowed to start a direct chat / add the user to a group.
 * 'followers' = approved followers (profile_relationships, state 'following');
 * 'contacts'  = people the user already shares a direct chat with.
 */
export type ContactPrivacy = 'everyone' | 'followers' | 'contacts' | 'no_one';

// Defaults closed: emails are never searchable unless a user explicitly
// opts in to exact-match lookup.
export type EmailDiscoverability = 'exact_match' | 'nobody';

export interface UserSettings {
  _id?: ObjectId;
  userId: ObjectId;
  readReceiptsEnabled: boolean;
  presenceVisible: boolean;
  lastSeenVisible: boolean;
  incomingCallsEnabled: boolean;
  themePreference: ThemePreference;
  chatIntelligenceEnabled: boolean;
  momentArchiveEnabled: boolean;
  messagePrivacy: ContactPrivacy;
  groupInvitePrivacy: ContactPrivacy;
  emailDiscoverability: EmailDiscoverability;
  timezone?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_USER_SETTINGS = {
  readReceiptsEnabled: true,
  presenceVisible: true,
  lastSeenVisible: true,
  incomingCallsEnabled: true,
  themePreference: 'system' as ThemePreference,
  chatIntelligenceEnabled: true,
  momentArchiveEnabled: true,
  messagePrivacy: 'everyone' as ContactPrivacy,
  groupInvitePrivacy: 'everyone' as ContactPrivacy,
  emailDiscoverability: 'nobody' as EmailDiscoverability,
  timezone: 'UTC',
};

export function getUserSettingsCollection(): Collection<UserSettings> {
  return getDatabase().collection<UserSettings>('userSettings');
}

export async function createUserSettingsIndexes(): Promise<void> {
  await getUserSettingsCollection().createIndex({ userId: 1 }, { unique: true });
}

export async function getOrCreateUserSettings(userId: ObjectId): Promise<UserSettings> {
  const collection = getUserSettingsCollection();
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        ...DEFAULT_USER_SETTINGS,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return {
    ...DEFAULT_USER_SETTINGS,
    ...(result ?? {}),
    userId,
    createdAt: result?.createdAt ?? now,
    updatedAt: result?.updatedAt ?? now,
  };
}
