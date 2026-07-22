import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from './db';
import {
  buildActionsDigestEmail,
  remainingDigestActions,
  sendActionsDigestEmail,
  type DigestActionItem,
} from './actions-email-digest';
import { getVisibleMyChatActionItems } from './routes/chat-actions';
import {
  getActionEmailDigestDeliveriesCollection,
  type ActionEmailDigestDeliveryDocument,
  type ActionEmailDigestDeliveryStatus,
} from './models/action-email-digest-delivery';
import {
  getActionEmailDigestPreferencesCollection,
  type ActionEmailDigestPreferenceDocument,
} from './models/action-email-digest-preference';

const PROCESSOR_INTERVAL_MS = Number(process.env.ACTIONS_EMAIL_DIGEST_WORKER_INTERVAL_MS || 15 * 60 * 1000);
const PROCESSOR_LOCK_ID = 'action-email-digests';

interface UserDocument {
  _id: ObjectId;
  username?: string;
  email?: string;
  name?: string;
}

interface ProcessorLockDocument {
  _id: string;
  expiresAt: Date;
  updatedAt: Date;
}

export interface ActionEmailDigestSender {
  send(message: { to: string; subject: string; html: string; text: string }): Promise<boolean>;
}

class SmtpActionEmailDigestSender implements ActionEmailDigestSender {
  send(message: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
    return sendActionsDigestEmail(message);
  }
}

export class ActionEmailDigestProcessor {
  constructor(
    private readonly sender: ActionEmailDigestSender = new SmtpActionEmailDigestSender(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async runOnce(): Promise<{
    checked: number;
    due: number;
    notDueYet: number;
    alreadySentToday: number;
    reserved: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    const lock = await acquireProcessorLock(this.now());
    if (!lock) {
      logger.info('Action email digest processor skipped; another worker holds the lock');
      return { checked: 0, due: 0, notDueYet: 0, alreadySentToday: 0, reserved: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const stats = { checked: 0, due: 0, notDueYet: 0, alreadySentToday: 0, reserved: 0, sent: 0, skipped: 0, failed: 0 };
    try {
      const preferences = await getActionEmailDigestPreferencesCollection()
        .find({ enabled: true })
        .limit(500)
        .toArray();
      stats.checked = preferences.length;

      for (const preference of preferences) {
        try {
          const outcome = await this.processPreference(preference);
          if (!outcome) continue;
          if (outcome.due) stats.due += 1;
          if (outcome.reserved) stats.reserved += 1;
          stats[outcome.status] += 1;
        } catch (error) {
          stats.failed += 1;
          logger.error(
            { event: 'actions_digest.daily_processor_user_failed', userId: preference.userId.toString(), errorName: error instanceof Error ? error.name : 'Error' },
            'Action email digest processor user failed'
          );
        }
      }

      logger.info(stats, 'Action email digest processor run completed');
      return stats;
    } finally {
      await releaseProcessorLock();
    }
  }

  private async processPreference(preference: ActionEmailDigestPreferenceDocument): Promise<{
    status: 'sent' | 'skipped' | 'failed' | 'notDueYet' | 'alreadySentToday';
    due?: boolean;
    reserved?: boolean;
  } | null> {
    const now = this.now();
    const parts = zonedParts(now, preference.timezone || 'UTC');
    if (parts.hour < preference.hourLocal) return { status: 'notDueYet' };

    const delivery = await reserveDelivery(preference, parts.dateKey, now);
    if (delivery.status === 'sent') return { status: 'alreadySentToday', due: true };
    if (delivery.status !== 'pending') return null;

    const user = await getDatabase()
      .collection<UserDocument>('users')
      .findOne({ _id: preference.userId, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } } as any);
    const email = user?.email?.trim();
    if (!email) {
      await markDelivery(delivery, 'skipped', now, 0, 'no_email');
      return { status: 'skipped', due: true, reserved: true };
    }

    const visibleActions = await getVisibleMyChatActionItems(preference.userId.toString());
    const remaining = remainingDigestActions((visibleActions || []) as DigestActionItem[], now);
    if (remaining.length === 0) {
      await markDelivery(delivery, 'skipped', now, 0, 'no_open_actions');
      return { status: 'skipped', due: true, reserved: true };
    }

    const digest = buildActionsDigestEmail({
      userName: user?.name || user?.username,
      userEmail: email,
      actions: remaining,
      now,
    });

    try {
      const sent = await this.sender.send({
        to: email,
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
      });
      if (!sent) {
        await markDelivery(delivery, 'failed', now, digest.count, 'send_failed');
        return { status: 'failed', due: true, reserved: true };
      }
      await markDelivery(delivery, 'sent', now, digest.count);
      return { status: 'sent', due: true, reserved: true };
    } catch {
      await markDelivery(delivery, 'failed', now, digest.count, 'send_failed');
      return { status: 'failed', due: true, reserved: true };
    }
  }
}

function zonedParts(date: Date, timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  }
  const parts = formatter.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
  };
}

async function reserveDelivery(
  preference: ActionEmailDigestPreferenceDocument,
  localDate: string,
  now: Date
): Promise<ActionEmailDigestDeliveryDocument> {
  const existing = await getActionEmailDigestDeliveriesCollection().findOne({
    userId: preference.userId,
    localDate,
  });
  if (existing) return existing;

  try {
    const result = await getActionEmailDigestDeliveriesCollection().findOneAndUpdate(
      {
        userId: preference.userId,
        localDate,
      },
      {
        $setOnInsert: {
          userId: preference.userId,
          localDate,
          timezone: preference.timezone || 'UTC',
          scheduledHour: preference.hourLocal,
          status: 'pending',
          count: 0,
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return result!;
  } catch (error: any) {
    if (error?.code === 11000) {
      const existingAfterRace = await getActionEmailDigestDeliveriesCollection().findOne({
        userId: preference.userId,
        localDate,
      });
      if (existingAfterRace) return existingAfterRace;
    }
    throw error;
  }
}

async function markDelivery(
  delivery: ActionEmailDigestDeliveryDocument,
  status: Exclude<ActionEmailDigestDeliveryStatus, 'pending'>,
  now: Date,
  count: number,
  errorCategory?: string
) {
  await getActionEmailDigestDeliveriesCollection().updateOne(
    { _id: delivery._id },
    {
      $set: {
        status,
        count,
        updatedAt: now,
        ...(status === 'sent' ? { sentAt: now } : {}),
        ...(errorCategory ? { errorCategory: errorCategory.slice(0, 80) } : {}),
      },
    }
  );
}

async function acquireProcessorLock(now: Date): Promise<boolean> {
  const locks = getDatabase().collection<ProcessorLockDocument>('processor_locks');
  const expiresAt = new Date(now.getTime() + Math.min(PROCESSOR_INTERVAL_MS, 10 * 60 * 1000));
  const result = await locks.findOneAndUpdate(
    {
      _id: PROCESSOR_LOCK_ID,
      $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }],
    },
    {
      $set: {
        expiresAt,
        updatedAt: now,
      },
      $setOnInsert: { _id: PROCESSOR_LOCK_ID },
    },
    { upsert: true, returnDocument: 'after' }
  ).catch((error: any) => {
    if (error?.code === 11000) return null;
    throw error;
  });
  return Boolean(result);
}

async function releaseProcessorLock() {
  await getDatabase().collection<ProcessorLockDocument>('processor_locks').deleteOne({ _id: PROCESSOR_LOCK_ID });
}

let interval: NodeJS.Timeout | null = null;

export function startActionEmailDigestProcessor() {
  if (process.env.ACTIONS_EMAIL_DIGEST_WORKER_ENABLED === 'false' || process.env.NODE_ENV === 'test' || interval) return;
  const processor = new ActionEmailDigestProcessor();
  const run = () => {
    processor.runOnce().catch((error) => {
      logger.error({ error }, 'Action email digest processor run failed');
    });
  };
  interval = setInterval(run, PROCESSOR_INTERVAL_MS);
  run();
  logger.info({ intervalMs: PROCESSOR_INTERVAL_MS }, 'Action email digest processor started');
}

export function stopActionEmailDigestProcessor() {
  if (interval) clearInterval(interval);
  interval = null;
}
