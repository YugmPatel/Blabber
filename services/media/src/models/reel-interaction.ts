import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export const REEL_REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🙌'] as const;
export type ReelReactionEmoji = (typeof REEL_REACTION_EMOJIS)[number];

export interface ReelReactionDocument {
  _id: ObjectId;
  reelId: ObjectId;
  authorUserId: ObjectId;
  reactingUserId: ObjectId;
  emoji: ReelReactionEmoji;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReelCommentDocument {
  _id: ObjectId;
  reelId: ObjectId;
  reelAuthorUserId: ObjectId;
  authorUserId: ObjectId;
  body: string;
  createdAt: Date;
  deletedAt?: Date;
  deletedByUserId?: ObjectId;
}

export interface ReelSaveDocument {
  _id: ObjectId;
  reelId: ObjectId;
  userId: ObjectId;
  createdAt: Date;
}

export interface ReelNotificationCooldownDocument {
  _id: ObjectId;
  reelId: ObjectId;
  actorUserId: ObjectId;
  recipientUserId: ObjectId;
  kind: 'reaction' | 'comment';
  createdAt: Date;
  expiresAt: Date;
}

export function getReelReactionsCollection(): Collection<ReelReactionDocument> {
  return getDatabase().collection<ReelReactionDocument>('reel_reactions');
}

export function getReelCommentsCollection(): Collection<ReelCommentDocument> {
  return getDatabase().collection<ReelCommentDocument>('reel_comments');
}

export function getReelSavesCollection(): Collection<ReelSaveDocument> {
  return getDatabase().collection<ReelSaveDocument>('reel_saves');
}

export function getReelNotificationCooldownsCollection(): Collection<ReelNotificationCooldownDocument> {
  return getDatabase().collection<ReelNotificationCooldownDocument>('reel_notification_cooldowns');
}

export async function createReelInteractionIndexes() {
  await getReelReactionsCollection().createIndex({ reelId: 1, reactingUserId: 1 }, { unique: true, name: 'reel_reacting_user_unique' });
  await getReelReactionsCollection().createIndex({ reactingUserId: 1, updatedAt: -1 });
  await getReelCommentsCollection().createIndex({ reelId: 1, deletedAt: 1, createdAt: 1, _id: 1 }, { name: 'reel_comments_order' });
  await getReelCommentsCollection().createIndex({ authorUserId: 1, createdAt: -1 });
  await getReelSavesCollection().createIndex({ userId: 1, reelId: 1 }, { unique: true, name: 'reel_save_owner_unique' });
  await getReelSavesCollection().createIndex({ userId: 1, createdAt: -1 });
  await getReelNotificationCooldownsCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'reel_notification_cooldown_ttl' });
  await getReelNotificationCooldownsCollection().createIndex({ reelId: 1, actorUserId: 1, recipientUserId: 1, kind: 1 });
}
