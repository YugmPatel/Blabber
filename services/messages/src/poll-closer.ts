import { logger } from '@repo/utils';
import { getMessagesCollection } from './models/message';

export class PollCloseProcessor {
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly intervalMs = Number(process.env.POLL_CLOSE_INTERVAL_MS || 60000)) {}

  async runOnce(now = new Date()) {
    const result = await getMessagesCollection().updateMany(
      {
        type: 'poll',
        'poll.closed': { $ne: true },
        'poll.closedAt': { $exists: false },
        'poll.closesAt': { $lte: now },
      },
      {
        $set: {
          'poll.closed': true,
          'poll.closedAt': now,
          editedAt: now,
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.info({ count: result.modifiedCount }, 'Automatically closed expired polls');
    }
    return result.modifiedCount;
  }

  start() {
    if (this.interval || process.env.POLL_CLOSE_PROCESSOR_ENABLED === 'false') return;
    void this.runOnce().catch((error) => logger.error({ error }, 'Poll close processor failed'));
    this.interval = setInterval(() => {
      void this.runOnce().catch((error) => logger.error({ error }, 'Poll close processor failed'));
    }, this.intervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
