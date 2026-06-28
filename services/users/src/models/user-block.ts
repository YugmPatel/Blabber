import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface UserBlock {
  _id: ObjectId;
  blockerUserId: ObjectId;
  blockedUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function getUserBlocksCollection() {
  return getDatabase().collection<UserBlock>('user_blocks');
}

export async function createUserBlockIndexes(): Promise<void> {
  const collection = getUserBlocksCollection();
  await collection.createIndex({ blockerUserId: 1, blockedUserId: 1 }, { unique: true });
  await collection.createIndex({ blockedUserId: 1, blockerUserId: 1 });
}

export async function upsertUserBlock(blockerUserId: ObjectId, blockedUserId: ObjectId) {
  const now = new Date();
  await getUserBlocksCollection().updateOne(
    { blockerUserId, blockedUserId },
    {
      $setOnInsert: { _id: new ObjectId(), blockerUserId, blockedUserId, createdAt: now },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );
}

export async function removeUserBlock(blockerUserId: ObjectId, blockedUserId: ObjectId) {
  await getUserBlocksCollection().deleteOne({ blockerUserId, blockedUserId });
}

export async function hasBlockBetween(userA: ObjectId, userB: ObjectId): Promise<boolean> {
  const block = await getUserBlocksCollection().findOne({
    $or: [
      { blockerUserId: userA, blockedUserId: userB },
      { blockerUserId: userB, blockedUserId: userA },
    ],
  });
  return Boolean(block);
}

export async function listCounterpartBlockIds(userId: ObjectId): Promise<ObjectId[]> {
  const blocks = await getUserBlocksCollection()
    .find({
      $or: [{ blockerUserId: userId }, { blockedUserId: userId }],
    })
    .project<{ blockerUserId: ObjectId; blockedUserId: ObjectId }>({ blockerUserId: 1, blockedUserId: 1 })
    .toArray();

  return blocks.map((block) => (block.blockerUserId.equals(userId) ? block.blockedUserId : block.blockerUserId));
}
