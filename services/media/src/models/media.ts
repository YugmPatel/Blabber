import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface Media {
  _id?: ObjectId;
  userId: ObjectId;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  url: string;
  createdAt: Date;
}

export function getMediaCollection(): Collection<Media> {
  const db = getDatabase();
  return db.collection<Media>('media');
}

export async function createMediaIndexes(): Promise<void> {
  const collection = getMediaCollection();

  await collection.createIndex({ userId: 1 });
  await collection.createIndex({ createdAt: -1 });
}
