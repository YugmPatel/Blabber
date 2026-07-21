import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface ActionEmailDigestPreferenceDocument {
  _id?: ObjectId;
  userId: ObjectId;
  enabled: boolean;
  hourLocal: number;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export function getActionEmailDigestPreferencesCollection(): Collection<ActionEmailDigestPreferenceDocument> {
  return getDatabase().collection<ActionEmailDigestPreferenceDocument>('actionEmailDigestPreferences');
}

export async function createActionEmailDigestPreferenceIndexes(): Promise<void> {
  const collection = getActionEmailDigestPreferencesCollection();
  await collection.createIndex({ userId: 1 }, { unique: true, name: 'action_digest_preference_user' });
  await collection.createIndex({ enabled: 1, updatedAt: -1 }, { name: 'action_digest_enabled_updatedAt' });
}

export function defaultActionEmailDigestPreference(userId: ObjectId, now = new Date()): ActionEmailDigestPreferenceDocument {
  return {
    userId,
    enabled: false,
    hourLocal: 9,
    timezone: 'UTC',
    createdAt: now,
    updatedAt: now,
  };
}
