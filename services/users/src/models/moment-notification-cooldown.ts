import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export type MomentNotificationKind = 'moment_update' | 'moment_activity';

export interface MomentNotificationCooldownDocument {
  _id: ObjectId;
  kind: MomentNotificationKind;
  authorUserId: ObjectId;
  recipientUserId: ObjectId;
  viewerUserId?: ObjectId;
  momentId?: ObjectId;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getMomentNotificationCooldownsCollection(): Collection<MomentNotificationCooldownDocument> {
  return getDatabase().collection<MomentNotificationCooldownDocument>('moment_notification_cooldowns');
}

export async function createMomentNotificationCooldownIndexes(): Promise<void> {
  const collection = getMomentNotificationCooldownsCollection();
  try {
    await collection.createIndex(
      { kind: 1, authorUserId: 1, recipientUserId: 1 },
      {
        name: 'moment_update_cooldown_unique',
        unique: true,
        partialFilterExpression: { kind: 'moment_update' },
      }
    );
    await collection.createIndex(
      { kind: 1, momentId: 1, viewerUserId: 1, recipientUserId: 1 },
      {
        name: 'moment_activity_cooldown_unique',
        unique: true,
        partialFilterExpression: { kind: 'moment_activity' },
      }
    );
    logger.info('Moment notification cooldown indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create moment notification cooldown indexes');
    throw error;
  }
}
