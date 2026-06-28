import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface ProfileHandleReservation {
  _id: ObjectId;
  handle: string;
  reason: 'changed' | 'deleted';
  reservedUntil: Date;
  createdAt: Date;
}

export function getProfileHandleReservationsCollection(): Collection<ProfileHandleReservation> {
  return getDatabase().collection<ProfileHandleReservation>('profile_handle_reservations');
}

export async function createProfileHandleReservationIndexes(): Promise<void> {
  const collection = getProfileHandleReservationsCollection();
  await collection.createIndex({ handle: 1 }, { unique: true, name: 'profile_handle_reservation_handle_unique' });
  await collection.createIndex({ reservedUntil: 1 }, { name: 'profile_handle_reservation_expiry' });
}

export async function cleanupExpiredProfileHandleReservations(now = new Date()): Promise<number> {
  const result = await getProfileHandleReservationsCollection().deleteMany({ reservedUntil: { $lte: now } });
  return result.deletedCount ?? 0;
}
