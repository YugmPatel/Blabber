import { getDatabase } from '../db';
import { ObjectId } from 'mongodb';

export interface NotificationPreferences {
  _id?: ObjectId;
  userId: ObjectId;
  messageNotificationsEnabled: boolean;
  callNotificationsEnabled: boolean;
  notificationPreviewsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationPreferencePatch = Partial<
  Pick<
    NotificationPreferences,
    'messageNotificationsEnabled' | 'callNotificationsEnabled' | 'notificationPreviewsEnabled'
  >
>;

const DEFAULT_PREFERENCES = {
  messageNotificationsEnabled: false,
  callNotificationsEnabled: false,
  notificationPreviewsEnabled: false,
};

export async function createNotificationPreferenceIndexes() {
  const db = getDatabase();
  const collection = db.collection<NotificationPreferences>('notificationPreferences');
  await collection.createIndex({ userId: 1 }, { unique: true });
}

export async function getNotificationPreferences(
  userId: ObjectId
): Promise<NotificationPreferences> {
  const db = getDatabase();
  const collection = db.collection<NotificationPreferences>('notificationPreferences');
  const existing = await collection.findOne({ userId });

  if (existing) {
    return existing;
  }

  const now = new Date();
  const doc: NotificationPreferences = {
    userId,
    ...DEFAULT_PREFERENCES,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function updateNotificationPreferences(
  userId: ObjectId,
  patch: NotificationPreferencePatch
): Promise<NotificationPreferences> {
  const db = getDatabase();
  const collection = db.collection<NotificationPreferences>('notificationPreferences');
  const now = new Date();

  await getNotificationPreferences(userId);

  await collection.updateOne(
    { userId },
    {
      $set: {
        ...patch,
        updatedAt: now,
      },
    }
  );

  return getNotificationPreferences(userId);
}

export function serializeNotificationPreferences(preferences: NotificationPreferences) {
  return {
    userId: preferences.userId.toString(),
    messageNotificationsEnabled: preferences.messageNotificationsEnabled,
    callNotificationsEnabled: preferences.callNotificationsEnabled,
    notificationPreviewsEnabled: preferences.notificationPreviewsEnabled,
    updatedAt: preferences.updatedAt,
  };
}
