import { Collection, ObjectId } from 'mongodb';
import { createHash, randomBytes } from 'crypto';
import { getDatabase } from '../db';

export type AccountTokenPurpose =
  | 'email_verification'
  | 'email_change'
  | 'account_deletion_cancel'
  | 'data_export_download';

export interface EmailVerificationTokenDocument {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt?: Date;
  sentToEmail: string;
}

export interface PendingEmailChangeDocument {
  _id: ObjectId;
  userId: ObjectId;
  newEmail: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  confirmedAt?: Date;
}

export interface DataExportDocument {
  _id: ObjectId;
  userId: ObjectId;
  status: 'preparing' | 'ready' | 'expired' | 'failed';
  requestedAt: Date;
  readyAt?: Date;
  expiresAt: Date;
  failedAt?: Date;
  errorCode?: string;
  fileName?: string;
  contentType?: string;
  zipData?: Buffer;
  downloadTokenHash?: string;
}

export interface AccountDeletionDocument {
  _id: ObjectId;
  userId: ObjectId;
  status: 'pending' | 'cancelled' | 'finalized';
  requestedAt: Date;
  scheduledFor: Date;
  cancelTokenHash: string;
  cancelTokenExpiresAt: Date;
  cancelledAt?: Date;
  finalizedAt?: Date;
}

export interface AccountDeletionAuditDocument {
  _id: ObjectId;
  userIdHash: string;
  deletionId: ObjectId;
  finalizedAt: Date;
  stats: Record<string, number>;
}

export interface CapturedEmailDocument {
  _id: ObjectId;
  userId?: ObjectId;
  toHash: string;
  subject: string;
  text: string;
  purpose: string;
  createdAt: Date;
  expiresAt: Date;
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function hashUserId(userId: ObjectId) {
  return createHash('sha256').update(userId.toString()).digest('hex');
}

export function hashEmail(email: string) {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

export function getEmailVerificationTokensCollection(): Collection<EmailVerificationTokenDocument> {
  return getDatabase().collection<EmailVerificationTokenDocument>('emailVerificationTokens');
}

export function getPendingEmailChangesCollection(): Collection<PendingEmailChangeDocument> {
  return getDatabase().collection<PendingEmailChangeDocument>('pendingEmailChanges');
}

export function getDataExportsCollection(): Collection<DataExportDocument> {
  return getDatabase().collection<DataExportDocument>('dataExports');
}

export function getAccountDeletionsCollection(): Collection<AccountDeletionDocument> {
  return getDatabase().collection<AccountDeletionDocument>('accountDeletions');
}

export function getAccountDeletionAuditsCollection(): Collection<AccountDeletionAuditDocument> {
  return getDatabase().collection<AccountDeletionAuditDocument>('accountDeletionAudits');
}

export function getCapturedEmailsCollection(): Collection<CapturedEmailDocument> {
  return getDatabase().collection<CapturedEmailDocument>('capturedEmails');
}

export async function createAccountSecurityIndexes() {
  await getEmailVerificationTokensCollection().createIndex({ userId: 1, createdAt: -1 });
  await getEmailVerificationTokensCollection().createIndex({ tokenHash: 1 }, { unique: true });
  await getEmailVerificationTokensCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  await getPendingEmailChangesCollection().createIndex({ userId: 1, createdAt: -1 });
  await getPendingEmailChangesCollection().createIndex({ tokenHash: 1 }, { unique: true });
  await getPendingEmailChangesCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  await getDataExportsCollection().createIndex({ userId: 1, requestedAt: -1 });
  await getDataExportsCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await getDataExportsCollection().createIndex({ downloadTokenHash: 1 }, { sparse: true });

  await getAccountDeletionsCollection().createIndex({ userId: 1, status: 1 });
  await getAccountDeletionsCollection().createIndex({ status: 1, scheduledFor: 1 });
  await getAccountDeletionsCollection().createIndex({ cancelTokenHash: 1 }, { unique: true });

  await getAccountDeletionAuditsCollection().createIndex({ deletionId: 1 }, { unique: true });
  await getCapturedEmailsCollection().createIndex({ userId: 1, createdAt: -1 });
  await getCapturedEmailsCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
