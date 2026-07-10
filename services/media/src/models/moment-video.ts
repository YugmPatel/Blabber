import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { ReelHlsSegment, ReelProcessingStatus } from './reel';

export interface MomentVideoDocument {
  _id: ObjectId;
  authorUserId: ObjectId;
  sourceMediaId: ObjectId;
  momentId?: ObjectId;
  processingStatus: ReelProcessingStatus;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fallbackPath?: string;
  posterPath?: string;
  hlsPlaylistPath?: string;
  hlsSegments?: ReelHlsSegment[];
  validationFailureCategory?: string;
  processingAttempt?: number;
  processingLeaseId?: string;
  processingStartedAt?: Date;
  processedAt?: Date;
  publishedAt?: Date;
  updatedAt: Date;
  createdAt: Date;
  deletedAt?: Date;
  schemaVersion: 1;
}

export function getMomentVideosCollection(): Collection<MomentVideoDocument> {
  return getDatabase().collection<MomentVideoDocument>('moment_videos');
}

export async function createMomentVideoIndexes() {
  const collection = getMomentVideosCollection();
  await collection.createIndex({ authorUserId: 1, createdAt: -1 });
  await collection.createIndex({ processingStatus: 1, updatedAt: 1 });
  await collection.createIndex({ processingStatus: 1, processingStartedAt: 1, updatedAt: 1 });
  await collection.createIndex({ sourceMediaId: 1 }, { unique: true });
  await collection.createIndex({ momentId: 1 }, { sparse: true });
}
