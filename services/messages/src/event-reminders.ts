import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from './db';
import { getMessagesCollection, MessageDocument } from './models/message';
import {
  EventReminderType,
  createEventReminderDeliveryIndexes,
  markEventReminderDelivery,
  reserveEventReminderDelivery,
} from './models/event-reminder-delivery';

const PROCESSOR_INTERVAL_MS = Number(process.env.EVENT_REMINDER_INTERVAL_MS || 15 * 60 * 1000);

interface EventReminderNotificationPayload {
  userId: string;
  kind: 'event_reminder';
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface EventReminderSender {
  send(payload: EventReminderNotificationPayload): Promise<{ sent: number; inboxRecorded?: boolean; message?: string }>;
}

export class HttpEventReminderSender implements EventReminderSender {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3006') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async send(payload: EventReminderNotificationPayload) {
    const response = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({})) as { sent?: unknown; inboxRecorded?: unknown; message?: unknown };
    if (!response.ok) {
      throw new Error(typeof data.message === 'string' ? data.message : 'Notification delivery failed');
    }
    return {
      sent: typeof data.sent === 'number' ? data.sent : 0,
      inboxRecorded: data.inboxRecorded === true,
      message: typeof data.message === 'string' ? data.message : undefined,
    };
  }
}

const OFFSET_REMINDER_TYPES = new Map<number, EventReminderType>([
  [5, 'five_minutes_before'],
  [15, 'fifteen_minutes_before'],
  [60, 'hour_before'],
  [1440, 'day_before'],
]);

function eventStart(message: MessageDocument) {
  if (!message.event) return null;
  const start = message.event.startAt || new Date(message.event.startsAt);
  return Number.isNaN(start.getTime()) ? null : start;
}

function reminderWindows(message: MessageDocument, now: Date) {
  const startAt = eventStart(message);
  if (!startAt || startAt.getTime() <= now.getTime()) return [];
  const offsetMinutes = message.event?.reminderOffsetMinutes;
  if (offsetMinutes) {
    const reminderType = OFFSET_REMINDER_TYPES.get(offsetMinutes);
    if (!reminderType) return [];
    return now.getTime() >= startAt.getTime() - offsetMinutes * 60 * 1000 ? [reminderType] : [];
  }
  const windows: EventReminderType[] = [];
  if (now.getTime() >= startAt.getTime() - 24 * 60 * 60 * 1000) windows.push('day_before');
  if (now.getTime() >= startAt.getTime() - 60 * 60 * 1000) windows.push('hour_before');
  return windows;
}

function scheduleVersion(message: MessageDocument) {
  return `${eventStart(message)?.toISOString() || message.event?.startsAt || 'unknown'}:${message.event?.updatedAt?.toISOString() || ''}`;
}

function reminderWindowKey(message: MessageDocument, reminderType: EventReminderType) {
  return `${message._id.toString()}:${reminderType}:${scheduleVersion(message)}`;
}

export class EventReminderProcessor {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly sender: EventReminderSender = new HttpEventReminderSender(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async runOnce() {
    const now = this.now();
    const maxStartAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const candidates = await getMessagesCollection()
      .find({
        type: 'event',
        'event.cancelledAt': { $exists: false },
        'event.reminderEnabled': { $ne: false },
        $or: [
          { 'event.startAt': { $gt: now, $lte: maxStartAt } },
          { 'event.startsAt': { $gte: now.toISOString(), $lte: maxStartAt.toISOString() } },
        ],
      })
      .limit(500)
      .toArray();

    const stats = { checked: candidates.length, reserved: 0, sent: 0, skipped: 0, failed: 0 };
    for (const message of candidates) {
      const windows = reminderWindows(message, now);
      if (!message.event?.rsvps?.length || windows.length === 0) continue;

      for (const rsvp of message.event.rsvps) {
        if (rsvp.status !== 'going') continue;
        for (const reminderType of windows) {
          const reserved = await reserveEventReminderDelivery({
            eventId: message._id,
            userId: rsvp.userId,
            reminderType,
            reminderWindowKey: reminderWindowKey(message, reminderType),
            eventScheduleVersion: scheduleVersion(message),
            attemptedAt: now,
          });
          if (!reserved?._id) continue;
          stats.reserved += 1;

          const outcome = await this.deliver(message, rsvp.userId, reminderType);
          stats[outcome] += 1;
          await markEventReminderDelivery(reserved._id, outcome === 'sent' ? 'sent' : outcome, {
            skippedReason: outcome === 'skipped' ? 'not eligible or no subscription' : undefined,
            errorCode: outcome === 'failed' ? 'delivery_failed' : undefined,
          });
        }
      }
    }

    if (stats.reserved > 0) logger.info(stats, 'Event reminder processor completed');
    return stats;
  }

  private async deliver(message: MessageDocument, userId: ObjectId, reminderType: EventReminderType) {
    const eligible = await this.isStillEligible(message, userId, reminderType);
    if (!eligible) return 'skipped' as const;

    const startAt = eventStart(message)!;
    const title = reminderTitle(reminderType);
    const time = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: message.event?.timezone || 'UTC',
    }).format(startAt);

    try {
      const result = await this.sender.send({
        userId: userId.toString(),
        kind: 'event_reminder',
        title,
        body: `${message.event!.title} at ${time}`,
        data: {
          chatId: message.chatId.toString(),
          messageId: message._id.toString(),
          route: `/chats/${message.chatId.toString()}?message=${message._id.toString()}`,
        },
      });
      return result.inboxRecorded || result.sent > 0 ? 'sent' as const : 'skipped' as const;
    } catch (error) {
      logger.error({ error, messageId: message._id.toString(), userId: userId.toString() }, 'Event reminder failed');
      return 'failed' as const;
    }
  }

  private async isStillEligible(message: MessageDocument, userId: ObjectId, reminderType: EventReminderType) {
    const db = getDatabase();
    const [latest, chat, preferences] = await Promise.all([
      getMessagesCollection().findOne({ _id: message._id }),
      db.collection('chats').findOne({ _id: message.chatId }),
      db.collection('notificationPreferences').findOne({ userId }),
    ]);
    if (!latest?.event || latest.event.cancelledAt || latest.event.reminderEnabled === false) return false;
    if (!chat || chat.deletedAt || !chat.participants?.some((participantId: ObjectId) => participantId.equals(userId))) return false;
    if (chat.expiresAt && new Date(chat.expiresAt).getTime() <= this.now().getTime()) return false;
    if (preferences?.eventRemindersEnabled === false) return false;
    if (reminderType === 'day_before' && preferences?.eventReminderDayBeforeEnabled === false) return false;
    if (reminderType === 'hour_before' && preferences?.eventReminderHourBeforeEnabled === false) return false;
    const latestRsvp = latest.event.rsvps?.find((rsvp) => rsvp.userId.equals(userId));
    if (latestRsvp?.status !== 'going') return false;
    return true;
  }

  async start() {
    if (this.interval || process.env.EVENT_REMINDER_PROCESSOR_ENABLED === 'false') return;
    await createEventReminderDeliveryIndexes();
    void this.runOnce().catch((error) => logger.error({ error }, 'Event reminder processor failed'));
    this.interval = setInterval(() => {
      void this.runOnce().catch((error) => logger.error({ error }, 'Event reminder processor failed'));
    }, PROCESSOR_INTERVAL_MS);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

function reminderTitle(reminderType: EventReminderType) {
  if (reminderType === 'five_minutes_before') return 'Event starts in 5 minutes';
  if (reminderType === 'fifteen_minutes_before') return 'Event starts in 15 minutes';
  if (reminderType === 'hour_before') return 'Event starts in 1 hour';
  return 'Event tomorrow';
}
