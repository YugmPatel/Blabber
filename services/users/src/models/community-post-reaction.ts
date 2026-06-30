import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export const COMMUNITY_REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🙌'] as const;
export type CommunityReactionEmoji = (typeof COMMUNITY_REACTION_EMOJIS)[number];

export interface CommunityPostReactionDocument {
  _id: ObjectId;
  communityId: ObjectId;
  communityPostId: ObjectId;
  postAuthorUserId: ObjectId;
  reactingUserId: ObjectId;
  emoji: CommunityReactionEmoji;
  createdAt: Date;
  updatedAt: Date;
}

export function getCommunityPostReactionsCollection() {
  return getDatabase().collection<CommunityPostReactionDocument>('community_post_reactions');
}

export async function createCommunityPostReactionIndexes() {
  const collection = getCommunityPostReactionsCollection();
  await collection.createIndex({ communityPostId: 1, reactingUserId: 1 }, { unique: true });
  await collection.createIndex({ reactingUserId: 1, createdAt: -1 });
}
