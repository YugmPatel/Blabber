import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface CloseFriendDocument {
  _id: ObjectId;
  ownerUserId: ObjectId;
  friendUserId: ObjectId;
  createdAt: Date;
}

export function getCloseFriendsCollection(): Collection<CloseFriendDocument> {
  return getDatabase().collection<CloseFriendDocument>('close_friends');
}

export async function createCloseFriendIndexes(): Promise<void> {
  const collection = getCloseFriendsCollection();
  await collection.createIndex({ ownerUserId: 1, friendUserId: 1 }, { unique: true, name: 'owner_friend_unique' });
  await collection.createIndex({ friendUserId: 1, ownerUserId: 1 }, { name: 'friend_owner' });
}
