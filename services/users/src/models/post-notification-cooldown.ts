import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export type PostNotificationKind = 'reaction' | 'comment';

export interface PostNotificationCooldownDocument {
  _id: ObjectId;
  postId: ObjectId;
  recipientUserId: ObjectId;
  actorUserId: ObjectId;
  kind: PostNotificationKind;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getPostNotificationCooldownsCollection(): Collection<PostNotificationCooldownDocument> {
  return getDatabase().collection<PostNotificationCooldownDocument>('post_notification_cooldowns');
}

export async function createPostNotificationCooldownIndexes(): Promise<void> {
  const collection = getPostNotificationCooldownsCollection();
  try {
    await collection.createIndex(
      { postId: 1, recipientUserId: 1, actorUserId: 1, kind: 1 },
      { unique: true, name: 'post_recipient_actor_kind_unique' }
    );
    await collection.createIndex({ updatedAt: 1 }, { name: 'updatedAt' });
    logger.info('Post notification cooldown indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create post notification cooldown indexes');
    throw error;
  }
}
