import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface Media {
  _id?: ObjectId;
  userId: ObjectId;
  fileName: string;
  originalFileName?: string;
  fileType: string;
  detectedFileType?: string;
  fileSize: number;
  s3Key: string;
  url: string;
  storage?: 's3' | 'local';
  localPath?: string;
  status?: 'pending' | 'scanning' | 'approved' | 'rejected' | 'quarantined' | 'deleted';
  purpose?: 'general' | 'reel_source' | 'reel_derivative' | 'reel_poster';
  reelId?: ObjectId;
  scanMode?: 'clamav' | 'mock' | 'disabled';
  scanResult?: 'clean' | 'infected' | 'error' | 'skipped';
  scanErrorCategory?: string;
  approvedAt?: Date;
  rejectedAt?: Date;
  quarantinedAt?: Date;
  createdAt: Date;
  uploadedAt?: Date;
}

export function getMediaCollection(): Collection<Media> {
  const db = getDatabase();
  return db.collection<Media>('media');
}

export async function createMediaIndexes(): Promise<void> {
  const collection = getMediaCollection();

  await collection.createIndex({ userId: 1 });
  await collection.createIndex({ createdAt: -1 });
  await collection.createIndex({ status: 1, createdAt: 1 });
  await collection.createIndex({ approvedAt: -1 }, { sparse: true });
}
