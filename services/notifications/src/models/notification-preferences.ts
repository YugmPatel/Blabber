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
  postActivityEnabled: boolean;
  reelActivityEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "HH:MM" in the user's saved timezone
  quietHoursEnd: string; // "HH:MM" in the user's saved timezone
  quietHoursTimezone: string; // IANA timezone captured from the client; '' falls back to UTC
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
    | 'postActivityEnabled'
    | 'reelActivityEnabled'
    | 'quietHoursEnabled'
    | 'quietHoursStart'
    | 'quietHoursEnd'
    | 'quietHoursTimezone'
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
  postActivityEnabled: true,
  reelActivityEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  quietHoursTimezone: '',
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
    postActivityEnabled:
      preferences.postActivityEnabled ?? DEFAULT_PREFERENCES.postActivityEnabled,
    reelActivityEnabled:
      preferences.reelActivityEnabled ?? DEFAULT_PREFERENCES.reelActivityEnabled,
    quietHoursEnabled: preferences.quietHoursEnabled ?? DEFAULT_PREFERENCES.quietHoursEnabled,
    quietHoursStart: preferences.quietHoursStart ?? DEFAULT_PREFERENCES.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd ?? DEFAULT_PREFERENCES.quietHoursEnd,
    quietHoursTimezone: preferences.quietHoursTimezone ?? DEFAULT_PREFERENCES.quietHoursTimezone,
    updatedAt: preferences.updatedAt,
  };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * True when `now` falls inside the user's quiet-hours window. Supports
 * overnight windows (e.g. 22:00–07:00). Equal start/end means no window.
 * Falls back to UTC when no timezone was saved or the saved one is invalid.
 */
export function isWithinQuietHours(preferences: NotificationPreferences, now: Date = new Date()): boolean {
  if (!preferences.quietHoursEnabled) return false;
  const start = preferences.quietHoursStart ?? DEFAULT_PREFERENCES.quietHoursStart;
  const end = preferences.quietHoursEnd ?? DEFAULT_PREFERENCES.quietHoursEnd;
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start === end) return false;

  let localTime: string;
  try {
    localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: preferences.quietHoursTimezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  }
  const current = minutesOfDay(localTime);
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);
  return startMinutes < endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
}
