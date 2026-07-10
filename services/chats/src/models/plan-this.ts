import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export type PlanThisSourceType = 'post' | 'reel';
export type PlanThisState = 'draft' | 'proposed' | 'voting' | 'ready_to_finalize' | 'finalized' | 'cancelled' | 'expired';
export type PlanThisVoteStatus = 'going' | 'maybe' | 'not_joining';
export type PlanThisAssignmentStatus = 'requested' | 'accepted' | 'declined';
export type PlanThisTaskStatus = 'unassigned' | 'pending_response' | 'accepted' | 'declined' | 'cancelled' | 'completed';

export interface PlanThisSource {
  type: PlanThisSourceType;
  sourceId: ObjectId;
  previewLabel: string;
  creatorLabel?: string;
  topics?: string[];
}

export interface PlanThisParticipant {
  userId: ObjectId;
  displayName?: string;
  removedAt?: Date;
}

export interface PlanThisVote {
  userId: ObjectId;
  status: PlanThisVoteStatus;
  planVersion?: number;
  updatedAt: Date;
}

export interface PlanThisAssignment {
  id: string;
  title: string;
  details?: string;
  dueAt?: Date;
  assigneeUserId?: ObjectId;
  status: PlanThisAssignmentStatus;
  taskStatus?: PlanThisTaskStatus;
  acceptedBy?: ObjectId;
  acceptedAt?: Date;
  declinedAt?: Date;
  declineReason?: string;
  actionId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanThisDocument {
  _id: ObjectId;
  chatId: ObjectId;
  creatorUserId: ObjectId;
  clientRequestId?: string;
  source: PlanThisSource;
  state: PlanThisState;
  title: string;
  description: string;
  suggestedAt?: Date;
  suggestedLocation?: string;
  budgetNotes?: string;
  checklist: string[];
  participants: PlanThisParticipant[];
  votes: PlanThisVote[];
  assignments: PlanThisAssignment[];
  proposalMessageId?: ObjectId;
  eventMessageId?: ObjectId;
  eventReminderOffsetMinutes?: number;
  updateCount: number;
  planVersion?: number;
  lastMaterialChangeAt?: Date;
  finalizedAt?: Date;
  cancelledAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function getPlanThisCollection(): Collection<PlanThisDocument> {
  return getDatabase().collection<PlanThisDocument>('plan_this_plans');
}

export async function createPlanThisIndexes(): Promise<void> {
  const collection = getPlanThisCollection();
  try {
    await collection.createIndex({ chatId: 1, updatedAt: -1 }, { name: 'plan_chat_updated' });
    await collection.createIndex({ creatorUserId: 1, updatedAt: -1 }, { name: 'plan_creator_updated' });
    await collection.createIndex({ 'participants.userId': 1, state: 1, updatedAt: -1 }, { name: 'plan_participant_state' });
    await collection.createIndex({ proposalMessageId: 1 }, { name: 'plan_proposal_message', sparse: true });
    await collection.createIndex({ eventMessageId: 1 }, { name: 'plan_event_message', sparse: true });
    await collection.createIndex({ 'source.type': 1, 'source.sourceId': 1 }, { name: 'plan_source' });
    // A compound sparse index only excludes a document when *every* indexed field is missing;
    // chatId/creatorUserId always exist, so pre-existing Plans without a clientRequestId would
    // all collide on an implicit null value. A partial filter on the field's actual presence
    // avoids that entirely.
    await collection.createIndex(
      { chatId: 1, creatorUserId: 1, clientRequestId: 1 },
      {
        name: 'plan_client_request_id',
        unique: true,
        partialFilterExpression: { clientRequestId: { $type: 'string' } },
      }
    );
    logger.info('Plan This indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create Plan This indexes');
    throw error;
  }
}
