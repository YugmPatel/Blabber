import { randomBytes } from 'crypto';
import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export interface UserInviteDocument {
  _id: ObjectId;
  token: string;
  inviterUserId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  useCount: number;
}

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getUserInvitesCollection(): Collection<UserInviteDocument> {
  return getDatabase().collection<UserInviteDocument>('user_invites');
}

export async function createUserInviteIndexes(): Promise<void> {
  const collection = getUserInvitesCollection();
  await collection.createIndex({ token: 1 }, { unique: true, name: 'user_invite_token_unique' });
  await collection.createIndex({ inviterUserId: 1, createdAt: -1 }, { name: 'user_invite_inviter_created' });
}

export function generateInviteToken(): string {
  // 24 random bytes = 32 base64url chars — unguessable, URL-safe.
  return randomBytes(24).toString('base64url');
}

export async function createUserInvite(inviterUserId: ObjectId): Promise<UserInviteDocument> {
  const now = new Date();
  const doc: UserInviteDocument = {
    _id: new ObjectId(),
    token: generateInviteToken(),
    inviterUserId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    useCount: 0,
  };
  await getUserInvitesCollection().insertOne(doc);
  return doc;
}

export async function findActiveInviteByToken(token: string): Promise<UserInviteDocument | null> {
  return getUserInvitesCollection().findOne({
    token,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
}
