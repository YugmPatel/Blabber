import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type ReelVisibility = 'public' | 'followers';
export type ReelProcessingStatus =
  | 'upload_initiated'
  | 'uploaded'
  | 'scanning'
  | 'validating'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'failed'
  | 'deleted';
export type ReelPublishState = 'draft' | 'published' | 'deleted';

export interface ReelHlsSegment {
  token: string;
  path: string;
  durationSeconds: number;
}

export interface ReelDocument {
  _id: ObjectId;
  authorUserId: ObjectId;
  sourceMediaId: ObjectId;
  processingStatus: ReelProcessingStatus;
  publishState: ReelPublishState;
  caption: string;
  visibility: ReelVisibility;
  topicIds: string[];
  reelDiscoverable?: boolean;
  reelTopicIds?: string[];
  reelDiscoverableUpdatedAt?: Date;
  reactionCounts?: Record<string, number>;
  commentCount?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fallbackPath?: string;
  posterPath?: string;
  hlsPlaylistPath?: string;
  hlsSegments?: ReelHlsSegment[];
  validationFailureCategory?: string;
  processingAttempt?: number;
  processingKey: string;
  processingStartedAt?: Date;
  processedAt?: Date;
  publishedAt?: Date;
  updatedAt: Date;
  createdAt: Date;
  deletedAt?: Date;
  moderationRemovedAt?: Date;
  schemaVersion: 1;
}

export function getReelsCollection(): Collection<ReelDocument> {
  return getDatabase().collection<ReelDocument>('reels');
}

export async function createReelIndexes() {
  const collection = getReelsCollection();
  await collection.createIndex({ authorUserId: 1, createdAt: -1 });
  await collection.createIndex({ processingStatus: 1, updatedAt: 1 });
  await collection.createIndex({ publishState: 1, visibility: 1, publishedAt: -1 });
  await collection.createIndex({ reelDiscoverable: 1, publishState: 1, visibility: 1, processingStatus: 1, publishedAt: -1, _id: -1 });
  await collection.createIndex({ reelTopicIds: 1, reelDiscoverable: 1, publishedAt: -1 });
  await collection.createIndex({ sourceMediaId: 1 }, { unique: true });
  await collection.createIndex({ processingKey: 1 }, { unique: true });
}
