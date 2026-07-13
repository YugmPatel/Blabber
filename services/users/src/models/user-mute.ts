import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface UserMute {
  _id: ObjectId;
  muterUserId: ObjectId;
  mutedUserId: ObjectId;
  createdAt: Date;
}

export function getUserMutesCollection(): Collection<UserMute> {
  return getDatabase().collection<UserMute>('user_mutes');
}

export async function createUserMuteIndexes(): Promise<void> {
  const collection = getUserMutesCollection();
  await collection.createIndex({ muterUserId: 1, mutedUserId: 1 }, { unique: true, name: 'user_mute_pair_unique' });
  await collection.createIndex({ mutedUserId: 1 }, { name: 'user_mute_by_target' });
}

export async function upsertUserMute(muterUserId: ObjectId, mutedUserId: ObjectId): Promise<void> {
  await getUserMutesCollection().updateOne(
    { muterUserId, mutedUserId },
    { $setOnInsert: { _id: new ObjectId(), muterUserId, mutedUserId, createdAt: new Date() } },
    { upsert: true }
  );
}

export async function removeUserMute(muterUserId: ObjectId, mutedUserId: ObjectId): Promise<void> {
  await getUserMutesCollection().deleteOne({ muterUserId, mutedUserId });
}

export async function isMuted(muterUserId: ObjectId, mutedUserId: ObjectId): Promise<boolean> {
  return Boolean(await getUserMutesCollection().findOne({ muterUserId, mutedUserId }));
}
