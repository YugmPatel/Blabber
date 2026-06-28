import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface MomentViewDocument {
  _id: ObjectId;
  momentId: ObjectId;
  viewerUserId: ObjectId;
  viewedAt: Date;
}

export function getMomentViewsCollection(): Collection<MomentViewDocument> {
  return getDatabase().collection<MomentViewDocument>('moment_views');
}

export async function createMomentViewIndexes(): Promise<void> {
  const collection = getMomentViewsCollection();
  await collection.createIndex({ momentId: 1, viewerUserId: 1 }, { unique: true, name: 'moment_viewer_unique' });
  await collection.createIndex({ momentId: 1, viewedAt: -1 }, { name: 'moment_viewedAt' });
  await collection.createIndex({ viewerUserId: 1, viewedAt: -1 }, { name: 'viewer_viewedAt' });
}
