import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getMomentsCollection } from '../models/moment';
import { getMomentViewsCollection } from '../models/moment-view';
import { getMomentReactionsCollection } from '../models/moment-reaction';
import { getMomentNotificationCooldownsCollection } from '../models/moment-notification-cooldown';
import { getOrCreateUserSettings } from '../models/user-settings';
import { safelyDeleteMomentMedia } from '../moment-media-cleanup';
import { getDatabase } from '../db';

export class MomentExpiryProcessor {
  async runOnce(now = new Date()) {
    const moments = await getMomentsCollection()
      .find({ archiveState: 'active', expiresAt: { $lte: now } })
      .limit(250)
      .toArray();

    let archived = 0;
    let deleted = 0;

    for (const moment of moments) {
      const settings = await getOrCreateUserSettings(moment.authorUserId);
      if (settings.momentArchiveEnabled) {
        const result = await getMomentsCollection().updateOne(
          { _id: moment._id, archiveState: 'active' },
          { $set: { archiveState: 'archived', expiredAt: now } }
        );
        archived += result.modifiedCount;
      } else {
        const result = await getMomentsCollection().updateOne(
          { _id: moment._id, archiveState: 'active' },
          { $set: { archiveState: 'deleted', deletedAt: now, expiredAt: now } }
        );
        if (result.modifiedCount) {
          deleted += 1;
          await getMomentViewsCollection().deleteMany({ momentId: moment._id });
          await getMomentReactionsCollection().deleteMany({ momentId: moment._id });
          await getMomentNotificationCooldownsCollection().deleteMany({ momentId: moment._id });
          await getDatabase().collection('messages').updateMany(
            { 'momentReply.momentId': moment._id },
            { $unset: { momentReply: '' } }
          );
          if (moment.mediaId instanceof ObjectId) await safelyDeleteMomentMedia(moment.mediaId, moment._id);
        }
      }
    }

    if (archived || deleted) logger.info({ archived, deleted }, 'Moment expiry worker completed');
    return { scanned: moments.length, archived, deleted };
  }
}

export function startMomentExpiryProcessor() {
  const intervalMs = Number(process.env.MOMENT_EXPIRY_INTERVAL_MS || 60_000);
  const processor = new MomentExpiryProcessor();
  const run = () => processor.runOnce().catch((error) => logger.error({ error }, 'Moment expiry worker failed'));
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}
