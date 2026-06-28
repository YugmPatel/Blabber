import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type ReportTargetType = 'user' | 'message' | 'group';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface TrustReport {
  _id: ObjectId;
  reporterUserId: ObjectId;
  targetType: ReportTargetType;
  targetUserId?: ObjectId;
  targetMessageId?: ObjectId;
  targetChatId?: ObjectId;
  reason: string;
  details?: string;
  status: ReportStatus;
  duplicateKey: string;
  evidence: Record<string, unknown>;
  evidencePurgedAt?: Date;
  internalNote?: string;
  reviewedBy?: ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionExpiresAt: Date;
}

export function getReportsCollection() {
  return getDatabase().collection<TrustReport>('reports');
}

export async function createReportIndexes(): Promise<void> {
  const collection = getReportsCollection();
  await collection.createIndex({ reporterUserId: 1, createdAt: -1 });
  await collection.createIndex({ duplicateKey: 1, createdAt: -1 });
  await collection.createIndex({ status: 1, createdAt: -1 });
  await collection.createIndex({ retentionExpiresAt: 1 });
}
