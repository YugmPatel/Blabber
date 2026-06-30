import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { DiscoveryTopicId } from '../discovery-topics';

export interface DiscoveryPreferenceDocument {
  _id: ObjectId;
  userId: ObjectId;
  personalizedDiscoveryEnabled: boolean;
  followedTopicIds: DiscoveryTopicId[];
  mutedTopicIds: DiscoveryTopicId[];
  createdAt: Date;
  updatedAt: Date;
}

export function getDiscoveryPreferencesCollection(): Collection<DiscoveryPreferenceDocument> {
  return getDatabase().collection<DiscoveryPreferenceDocument>('discovery_preferences');
}

export async function createDiscoveryPreferenceIndexes() {
  await getDiscoveryPreferencesCollection().createIndex({ userId: 1 }, { unique: true });
}

export async function ensureDiscoveryPreference(userId: ObjectId) {
  const now = new Date();
  await getDiscoveryPreferencesCollection().updateOne(
    { userId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        userId,
        personalizedDiscoveryEnabled: true,
        followedTopicIds: [],
        mutedTopicIds: [],
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );
  return getDiscoveryPreferencesCollection().findOne({ userId });
}
