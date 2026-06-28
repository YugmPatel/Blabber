import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from './db';
import { getChatsCollection, type Chat } from './models/chat';
import { getChatActionsCollection, type ChatActionDocument } from './models/chat-action';
import {
  getActionReminderDeliveriesCollection,
  type ActionReminderDeliveryDocument,
  type ActionReminderType,
} from './models/action-reminder-delivery';
import { isChatExpired } from './serialize-chat';

const REMINDER_HOUR = 9;
const PROCESSOR_INTERVAL_MS = Number(process.env.ACTION_REMINDER_INTERVAL_MS || 15 * 60 * 1000);
const PROCESSOR_LOOKBACK_DAYS = 60;
const STALE_DAYS = 7;
const MAX_OVERDUE_REMINDERS = 3;
const DEFAULT_TIMEZONE = 'UTC'; // Fallback only when user settings has no valid IANA timezone.

interface UserSettingsDocument {
  userId: ObjectId;
  timezone?: string;
}

interface NotificationPreferencesDocument {
  userId: ObjectId;
  actionRemindersEnabled?: boolean;
  actionReminderDueTomorrowEnabled?: boolean;
  actionReminderDueTodayEnabled?: boolean;
  actionReminderOverdueEnabled?: boolean;
  actionReminderStaleEnabled?: boolean;
}

interface ProcessorLockDocument {
  _id: string;
  expiresAt: Date;
  updatedAt: Date;
}

export interface ActionReminderNotificationPayload {
  userId: string;
  kind: 'action_reminder';
  title: string;
  body: string;
  data: {
    route: string;
    actionId: string;
    chatId: string;
    reminderType: ActionReminderType;
    sourceMessageId?: string;
  };
}

export interface ActionReminderSender {
  send(payload: ActionReminderNotificationPayload): Promise<{ sent: number; failed?: number; message?: string }>;
}

interface ReminderCandidate {
  action: ChatActionDocument;
  chat: Chat;
  ownerId: ObjectId;
  reminderType: ActionReminderType;
  reminderWindowKey: string;
  dueDateVersion: string;
  title: string;
  body: string;
}

export class HttpActionReminderSender implements ActionReminderSender {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3006') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async send(payload: ActionReminderNotificationPayload): Promise<{ sent: number; failed?: number; message?: string }> {
    const response = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({})) as { sent?: unknown; failed?: unknown; message?: unknown };
    if (!response.ok) {
      throw new Error(typeof data?.message === 'string' ? data.message : 'Notification delivery failed');
    }
    return {
      sent: typeof data.sent === 'number' ? data.sent : 0,
      failed: typeof data.failed === 'number' ? data.failed : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
    };
  }
}

export class ActionReminderProcessor {
  constructor(
    private readonly sender: ActionReminderSender = new HttpActionReminderSender(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async runOnce(): Promise<{ checked: number; reserved: number; sent: number; skipped: number; failed: number }> {
    const lock = await acquireProcessorLock(this.now());
    if (!lock) {
      logger.info('Action reminder processor skipped; another worker holds the lock');
      return { checked: 0, reserved: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const stats = { checked: 0, reserved: 0, sent: 0, skipped: 0, failed: 0 };
    try {
      const candidates = await this.findCandidates();
      stats.checked = candidates.length;

      for (const candidate of candidates) {
        const reserved = await reserveDelivery(candidate, this.now);
        if (!reserved) continue;
        stats.reserved += 1;

        const outcome = await this.deliver(candidate, reserved);
        stats[outcome] += 1;
      }

      logger.info(stats, 'Action reminder processor run completed');
      return stats;
    } finally {
      await releaseProcessorLock();
    }
  }

  private async findCandidates(): Promise<ReminderCandidate[]> {
    const now = this.now();
    const since = new Date(now.getTime() - PROCESSOR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const actions = await getChatActionsCollection()
      .find({
        deletedAt: { $exists: false },
        status: { $nin: ['completed', 'dismissed'] as any },
        'assignedTo.userId': { $exists: true, $ne: '' },
        $or: [
          { dueAt: { $gte: since } },
          { dueDate: { $exists: true } },
          { lastActivityAt: { $lte: new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000) } },
        ],
      })
      .limit(500)
      .toArray();

    const chatIds = Array.from(new Set(actions.map((action) => action.chatId.toString()))).map((id) => new ObjectId(id));
    const chats = await getChatsCollection().find({ _id: { $in: chatIds }, deletedAt: { $exists: false } }).toArray();
    const chatById = new Map(chats.map((chat) => [chat._id.toString(), chat]));

    const candidates: ReminderCandidate[] = [];
    for (const action of actions) {
      const chat = chatById.get(action.chatId.toString());
      if (!chat || (chat.type === 'group' && isChatExpired(chat))) continue;

      const ownerId = resolveActionOwner(action);
      if (!ownerId || !chat.participants.some((participantId) => participantId.equals(ownerId))) continue;
      if (action.visibility === 'personal' && !action.personalOwnerUserId?.equals(ownerId)) continue;

      const timezone = await getUserTimezone(ownerId);
      const preferences = await getReminderPreferences(ownerId);
      if (!preferences.actionRemindersEnabled) {
        candidates.push(...buildSkippedPreferenceCandidates(action, chat, ownerId, timezone, now));
        continue;
      }

      const dueReminder = await dueReminderCandidate(action, chat, ownerId, timezone, now, preferences);
      if (dueReminder) candidates.push(dueReminder);

      const staleReminder = staleReminderCandidate(action, chat, ownerId, timezone, now, preferences);
      if (staleReminder) candidates.push(staleReminder);
    }

    return candidates;
  }

  private async deliver(
    candidate: ReminderCandidate,
    delivery: ActionReminderDeliveryDocument
  ): Promise<'sent' | 'skipped' | 'failed'> {
    const stillEligible = await isStillEligible(candidate);
    if (!stillEligible) {
      await markDelivery(delivery, 'skipped', this.now(), 'not_eligible');
      return 'skipped';
    }
    if (!candidate.title || !candidate.body) {
      await markDelivery(delivery, 'skipped', this.now(), 'preference_disabled');
      return 'skipped';
    }

    try {
      const response = await this.sender.send({
        userId: candidate.ownerId.toString(),
        kind: 'action_reminder',
        title: candidate.title,
        body: candidate.body,
        data: {
          route: `/actions?actionId=${candidate.action._id.toString()}`,
          actionId: candidate.action._id.toString(),
          chatId: candidate.action.chatId.toString(),
          reminderType: candidate.reminderType,
          sourceMessageId: candidate.action.sourceMessageIds[0]?.toString(),
        },
      });

      if (response.sent <= 0) {
        await markDelivery(delivery, 'skipped', this.now(), response.message === 'No subscriptions found' ? 'no_subscription' : 'not_delivered');
        return 'skipped';
      }

      await markDelivery(delivery, 'sent', this.now());
      return 'sent';
    } catch (error) {
      await markDelivery(delivery, 'failed', this.now(), undefined, error instanceof Error ? error.message : 'send_failed');
      return 'failed';
    }
  }
}

function resolveActionOwner(action: ChatActionDocument): ObjectId | null {
  if (action.visibility === 'personal') return action.personalOwnerUserId ?? null;
  const ownerId = action.assignedTo?.userId;
  return ownerId && ObjectId.isValid(ownerId) ? new ObjectId(ownerId) : null;
}

async function getUserTimezone(userId: ObjectId): Promise<string> {
  const settings = await getDatabase().collection<UserSettingsDocument>('userSettings').findOne({ userId });
  return isValidTimezone(settings?.timezone) ? settings!.timezone! : DEFAULT_TIMEZONE;
}

async function getReminderPreferences(userId: ObjectId) {
  const preferences = await getDatabase().collection<NotificationPreferencesDocument>('notificationPreferences').findOne({ userId });
  return {
    actionRemindersEnabled: preferences?.actionRemindersEnabled ?? true,
    actionReminderDueTomorrowEnabled: preferences?.actionReminderDueTomorrowEnabled ?? true,
    actionReminderDueTodayEnabled: preferences?.actionReminderDueTodayEnabled ?? true,
    actionReminderOverdueEnabled: preferences?.actionReminderOverdueEnabled ?? true,
    actionReminderStaleEnabled: preferences?.actionReminderStaleEnabled ?? true,
  };
}

function isValidTimezone(value?: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  };
}

function isReminderWindow(now: Date, timezone: string): boolean {
  const parts = zonedParts(now, timezone);
  return parts.hour === REMINDER_HOUR && parts.minute < 45;
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function actionDueDateKey(action: ChatActionDocument, timezone: string): string | null {
  if (action.dueDate && /^\d{4}-\d{2}-\d{2}/.test(action.dueDate)) {
    return action.dueDate.slice(0, 10);
  }
  if (action.dueAt instanceof Date && !Number.isNaN(action.dueAt.getTime())) {
    return zonedParts(action.dueAt, timezone).dateKey;
  }
  return null;
}

function dueDateVersion(action: ChatActionDocument): string {
  return action.dueAt?.toISOString() || action.dueDate || 'no_due_date';
}

async function dueReminderCandidate(
  action: ChatActionDocument,
  chat: Chat,
  ownerId: ObjectId,
  timezone: string,
  now: Date,
  preferences: Awaited<ReturnType<typeof getReminderPreferences>>
): Promise<ReminderCandidate | null> {
  if (!isReminderWindow(now, timezone)) return null;
  const localToday = zonedParts(now, timezone).dateKey;
  const dueKey = actionDueDateKey(action, timezone);
  if (!dueKey) return null;

  const version = dueDateVersion(action);
  if (dueKey === addDays(localToday, 1)) {
    return preferences.actionReminderDueTomorrowEnabled
      ? candidate(action, chat, ownerId, 'due_tomorrow', localToday, version, 'Action due tomorrow', `${action.title} is due tomorrow.`)
      : candidate(action, chat, ownerId, 'due_tomorrow', localToday, version, '', '');
  }
  if (dueKey === localToday) {
    return preferences.actionReminderDueTodayEnabled
      ? candidate(action, chat, ownerId, 'due_today', localToday, version, 'Action due today', `${action.title} is due today.`)
      : candidate(action, chat, ownerId, 'due_today', localToday, version, '', '');
  }
  if (dueKey < localToday) {
    if (!preferences.actionReminderOverdueEnabled) {
      return candidate(action, chat, ownerId, 'overdue', localToday, version, '', '');
    }
    const sentCount = await getActionReminderDeliveriesCollection().countDocuments({
      actionId: action._id,
      userId: ownerId,
      reminderType: 'overdue',
      dueDateVersion: version,
      status: 'sent',
    });
    if (sentCount >= MAX_OVERDUE_REMINDERS) return null;
    return candidate(action, chat, ownerId, 'overdue', localToday, version, 'Action overdue', `${action.title} is overdue.`);
  }
  return null;
}

function staleReminderCandidate(
  action: ChatActionDocument,
  chat: Chat,
  ownerId: ObjectId,
  timezone: string,
  now: Date,
  preferences: Awaited<ReturnType<typeof getReminderPreferences>>
): ReminderCandidate | null {
  if (!isReminderWindow(now, timezone)) return null;
  if (actionDueDateKey(action, timezone) && actionDueDateKey(action, timezone)! < zonedParts(now, timezone).dateKey) return null;
  const lastActivity = action.lastActivityAt || action.createdAt;
  const lastActivityKey = zonedParts(lastActivity, timezone).dateKey;
  const localToday = zonedParts(now, timezone).dateKey;
  if (addDays(lastActivityKey, STALE_DAYS) > localToday) return null;
  const staleWindowIndex = Math.floor(daysBetween(lastActivityKey, localToday) / STALE_DAYS);
  if (!preferences.actionReminderStaleEnabled) {
    return candidate(action, chat, ownerId, 'stale', `${localToday}:stale-${staleWindowIndex}`, lastActivity.toISOString(), '', '');
  }
  return candidate(
    action,
    chat,
    ownerId,
    'stale',
    `${localToday}:stale-${staleWindowIndex}`,
    lastActivity.toISOString(),
    'Action needs an update',
    `${action.title} has had no update in 7 days.`
  );
}

function daysBetween(startKey: string, endKey: string): number {
  const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function candidate(
  action: ChatActionDocument,
  chat: Chat,
  ownerId: ObjectId,
  reminderType: ActionReminderType,
  reminderWindowKey: string,
  version: string,
  title: string,
  body: string
): ReminderCandidate {
  return { action, chat, ownerId, reminderType, reminderWindowKey, dueDateVersion: version, title, body };
}

function buildSkippedPreferenceCandidates(
  action: ChatActionDocument,
  chat: Chat,
  ownerId: ObjectId,
  timezone: string,
  now: Date
): ReminderCandidate[] {
  const localToday = zonedParts(now, timezone).dateKey;
  const dueKey = actionDueDateKey(action, timezone);
  const version = dueDateVersion(action);
  if (!isReminderWindow(now, timezone) || !dueKey) return [];
  if (dueKey === addDays(localToday, 1)) return [candidate(action, chat, ownerId, 'due_tomorrow', localToday, version, '', '')];
  if (dueKey === localToday) return [candidate(action, chat, ownerId, 'due_today', localToday, version, '', '')];
  if (dueKey < localToday) return [candidate(action, chat, ownerId, 'overdue', localToday, version, '', '')];
  return [];
}

async function reserveDelivery(candidate: ReminderCandidate, nowFn: () => Date): Promise<ActionReminderDeliveryDocument | null> {
  const now = nowFn();
  try {
    const result = await getActionReminderDeliveriesCollection().findOneAndUpdate(
      {
        actionId: candidate.action._id,
        userId: candidate.ownerId,
        reminderType: candidate.reminderType,
        reminderWindowKey: candidate.reminderWindowKey,
        dueDateVersion: candidate.dueDateVersion,
      },
      {
        $setOnInsert: {
          actionId: candidate.action._id,
          userId: candidate.ownerId,
          reminderType: candidate.reminderType,
          reminderWindowKey: candidate.reminderWindowKey,
          dueDateVersion: candidate.dueDateVersion,
          status: 'pending',
          createdAt: now,
        },
        $set: { attemptedAt: now, updatedAt: now },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return result?.status === 'pending' ? result : null;
  } catch (error: any) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function markDelivery(
  delivery: ActionReminderDeliveryDocument,
  status: 'sent' | 'skipped' | 'failed',
  now: Date,
  skippedReason?: string,
  errorCode?: string
) {
  await getActionReminderDeliveriesCollection().updateOne(
    { _id: delivery._id },
    {
      $set: {
        status,
        updatedAt: now,
        ...(status === 'sent' ? { sentAt: now } : {}),
        ...(skippedReason ? { skippedReason } : {}),
        ...(errorCode ? { errorCode: errorCode.slice(0, 160) } : {}),
      },
    }
  );
}

async function isStillEligible(candidate: ReminderCandidate): Promise<boolean> {
  const action = await getChatActionsCollection().findOne({
    _id: candidate.action._id,
    deletedAt: { $exists: false },
    status: { $nin: ['completed', 'dismissed'] as any },
  });
  if (!action) return false;
  const ownerId = resolveActionOwner(action);
  if (!ownerId?.equals(candidate.ownerId)) return false;
  const chat = await getChatsCollection().findOne({ _id: action.chatId, deletedAt: { $exists: false } });
  if (!chat || (chat.type === 'group' && isChatExpired(chat))) return false;
  if (!chat.participants.some((participantId) => participantId.equals(candidate.ownerId))) return false;
  if (action.visibility === 'personal' && !action.personalOwnerUserId?.equals(candidate.ownerId)) return false;
  return true;
}

async function acquireProcessorLock(now: Date): Promise<boolean> {
  const locks = getDatabase().collection<ProcessorLockDocument>('processor_locks');
  const expiresAt = new Date(now.getTime() + Math.min(PROCESSOR_INTERVAL_MS, 10 * 60 * 1000));
  const result = await locks.findOneAndUpdate(
    {
      _id: 'action-reminders',
      $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }],
    },
    {
      $set: {
        expiresAt,
        updatedAt: now,
      },
      $setOnInsert: { _id: 'action-reminders' },
    },
    { upsert: true, returnDocument: 'after' }
  ).catch((error: any) => {
    if (error?.code === 11000) return null;
    throw error;
  });
  return Boolean(result);
}

async function releaseProcessorLock() {
  await getDatabase().collection<ProcessorLockDocument>('processor_locks').deleteOne({ _id: 'action-reminders' });
}

let interval: NodeJS.Timeout | null = null;

export function startActionReminderProcessor() {
  if (process.env.ACTION_REMINDER_PROCESSOR_ENABLED === 'false' || interval) return;
  const processor = new ActionReminderProcessor();
  const run = () => {
    processor.runOnce().catch((error) => {
      logger.error({ error }, 'Action reminder processor run failed');
    });
  };
  interval = setInterval(run, PROCESSOR_INTERVAL_MS);
  run();
  logger.info({ intervalMs: PROCESSOR_INTERVAL_MS }, 'Action reminder processor started');
}

export function stopActionReminderProcessor() {
  if (interval) clearInterval(interval);
  interval = null;
}
