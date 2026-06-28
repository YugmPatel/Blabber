import { getDatabase } from '../db';
import { ObjectId } from 'mongodb';

export interface NotificationPreferences {
  _id?: ObjectId;
  userId: ObjectId;
  messageNotificationsEnabled: boolean;
  callNotificationsEnabled: boolean;
  notificationPreviewsEnabled: boolean;
  mentionNotificationsEnabled: boolean;
  actionRemindersEnabled: boolean;
  actionReminderDueTomorrowEnabled: boolean;
  actionReminderDueTodayEnabled: boolean;
  actionReminderOverdueEnabled: boolean;
  actionReminderStaleEnabled: boolean;
  eventRemindersEnabled: boolean;
  eventReminderDayBeforeEnabled: boolean;
  eventReminderHourBeforeEnabled: boolean;
  momentUpdatesEnabled: boolean;
  momentActivityEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationPreferencePatch = Partial<
  Pick<
    NotificationPreferences,
    | 'messageNotificationsEnabled'
    | 'callNotificationsEnabled'
    | 'notificationPreviewsEnabled'
    | 'mentionNotificationsEnabled'
    | 'actionRemindersEnabled'
    | 'actionReminderDueTomorrowEnabled'
    | 'actionReminderDueTodayEnabled'
    | 'actionReminderOverdueEnabled'
    | 'actionReminderStaleEnabled'
    | 'eventRemindersEnabled'
    | 'eventReminderDayBeforeEnabled'
    | 'eventReminderHourBeforeEnabled'
    | 'momentUpdatesEnabled'
    | 'momentActivityEnabled'
  >
>;

const DEFAULT_PREFERENCES = {
  messageNotificationsEnabled: false,
  callNotificationsEnabled: false,
  notificationPreviewsEnabled: false,
  mentionNotificationsEnabled: true,
  actionRemindersEnabled: true,
  actionReminderDueTomorrowEnabled: true,
  actionReminderDueTodayEnabled: true,
  actionReminderOverdueEnabled: true,
  actionReminderStaleEnabled: true,
  eventRemindersEnabled: true,
  eventReminderDayBeforeEnabled: true,
  eventReminderHourBeforeEnabled: true,
  momentUpdatesEnabled: false,
  momentActivityEnabled: true,
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
    return { ...DEFAULT_PREFERENCES, ...existing };
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
    mentionNotificationsEnabled:
      preferences.mentionNotificationsEnabled ?? DEFAULT_PREFERENCES.mentionNotificationsEnabled,
    actionRemindersEnabled:
      preferences.actionRemindersEnabled ?? DEFAULT_PREFERENCES.actionRemindersEnabled,
    actionReminderDueTomorrowEnabled:
      preferences.actionReminderDueTomorrowEnabled ?? DEFAULT_PREFERENCES.actionReminderDueTomorrowEnabled,
    actionReminderDueTodayEnabled:
      preferences.actionReminderDueTodayEnabled ?? DEFAULT_PREFERENCES.actionReminderDueTodayEnabled,
    actionReminderOverdueEnabled:
      preferences.actionReminderOverdueEnabled ?? DEFAULT_PREFERENCES.actionReminderOverdueEnabled,
    actionReminderStaleEnabled:
      preferences.actionReminderStaleEnabled ?? DEFAULT_PREFERENCES.actionReminderStaleEnabled,
    eventRemindersEnabled:
      preferences.eventRemindersEnabled ?? DEFAULT_PREFERENCES.eventRemindersEnabled,
    eventReminderDayBeforeEnabled:
      preferences.eventReminderDayBeforeEnabled ?? DEFAULT_PREFERENCES.eventReminderDayBeforeEnabled,
    eventReminderHourBeforeEnabled:
      preferences.eventReminderHourBeforeEnabled ?? DEFAULT_PREFERENCES.eventReminderHourBeforeEnabled,
    momentUpdatesEnabled:
      preferences.momentUpdatesEnabled ?? DEFAULT_PREFERENCES.momentUpdatesEnabled,
    momentActivityEnabled:
      preferences.momentActivityEnabled ?? DEFAULT_PREFERENCES.momentActivityEnabled,
    updatedAt: preferences.updatedAt,
  };
}
