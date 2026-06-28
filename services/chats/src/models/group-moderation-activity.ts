import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type GroupModerationAction =
  | 'send_mode_changed'
  | 'member_restricted'
  | 'member_unrestricted'
  | 'member_removed';

export interface GroupModerationActivity {
  _id: ObjectId;
  chatId: ObjectId;
  actorUserId: ObjectId;
  targetUserId?: ObjectId;
  action: GroupModerationAction;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: Date;
}

export function getGroupModerationActivityCollection() {
  return getDatabase().collection<GroupModerationActivity>('group_moderation_activity');
}

export async function createGroupModerationActivityIndexes(): Promise<void> {
  const collection = getGroupModerationActivityCollection();
  await collection.createIndex({ chatId: 1, createdAt: -1 });
  await collection.createIndex({ actorUserId: 1, createdAt: -1 });
}

export async function recordGroupModerationActivity(
  activity: Omit<GroupModerationActivity, '_id' | 'createdAt'>
) {
  await getGroupModerationActivityCollection().insertOne({
    _id: new ObjectId(),
    ...activity,
    createdAt: new Date(),
  });
}
