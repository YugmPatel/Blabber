import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface GroupInviteLink {
  _id?: ObjectId;
  chatId: ObjectId;
  tokenHash: string;
  createdBy: ObjectId;
  createdAt: Date;
  expiresAt?: Date | null;
  maxUses?: number | null;
  useCount: number;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
}

export function getGroupInviteLinksCollection(): Collection<GroupInviteLink> {
  return getDatabase().collection<GroupInviteLink>('groupInviteLinks');
}

export async function createGroupInviteLinkIndexes(): Promise<void> {
  const collection = getGroupInviteLinksCollection();
  await collection.createIndex({ chatId: 1, revokedAt: 1, expiresAt: 1 }, { name: 'invite_chat_active' });
  await collection.createIndex({ tokenHash: 1 }, { name: 'invite_token_hash', unique: true });
  await collection.createIndex(
    { chatId: 1 },
    {
      name: 'invite_one_active_per_chat',
      unique: true,
      partialFilterExpression: { revokedAt: null },
    }
  );
}
