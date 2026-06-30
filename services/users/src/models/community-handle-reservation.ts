import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CommunityHandleReservationDocument {
  _id: ObjectId;
  handle: string;
  reason: 'changed' | 'deleted';
  reservedUntil: Date;
  createdAt: Date;
}

export function getCommunityHandleReservationsCollection() {
  return getDatabase().collection<CommunityHandleReservationDocument>('community_handle_reservations');
}

export async function createCommunityHandleReservationIndexes() {
  const collection = getCommunityHandleReservationsCollection();
  await collection.createIndex({ handle: 1 }, { unique: true });
  await collection.createIndex({ reservedUntil: 1 }, { expireAfterSeconds: 0 });
}

export async function cleanupExpiredCommunityHandleReservations() {
  await getCommunityHandleReservationsCollection().deleteMany({ reservedUntil: { $lte: new Date() } });
}
