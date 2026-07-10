import { Collection, ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from '../db';

export type VeyraScopeType = 'general' | 'my_actions' | 'chat' | 'community';
export type VeyraIntentCategory =
  | 'greeting'
  | 'general_help'
  | 'identity'
  | 'acknowledgment'
  | 'unclear'
  | 'capability_spaces'
  | 'decision_recap'
  | 'action_status'
  | 'plan_status'
  | 'plan_creator'
  | 'latest_shared_item'
  | 'navigation_help'
  // Retrieval V1 — explicit find/list/search requests, each backed by a
  // permissioned tool in `veyra-retrieval.ts` rather than a canned summary.
  | 'find_photos'
  | 'find_documents'
  | 'find_links'
  | 'find_plans'
  | 'search_messages'
  // Action-class language (send/forward/create/update/delete). This batch
  // never performs the side effect — it returns a confirmation-ready proposal.
  | 'action_request';

// Intents Veyra can answer without any approved scope — small talk, "what can
// you do", and static app-navigation help never touch private Blabber data.
export const GENERAL_VEYRA_INTENTS: ReadonlySet<VeyraIntentCategory> = new Set([
  'greeting',
  'general_help',
  'identity',
  'acknowledgment',
  'unclear',
  'capability_spaces',
  'navigation_help',
]);

// Intents that require finding and presenting authorized content, as opposed
// to the existing canned/derived scoped answers (decision_recap, action_status,
// plan_status, latest_shared_item) or general conversation.
export const RETRIEVAL_VEYRA_INTENTS: ReadonlySet<VeyraIntentCategory> = new Set([
  'find_photos',
  'find_documents',
  'find_links',
  'find_plans',
  'search_messages',
]);

export type VeyraResultType = 'chat' | 'message' | 'link' | 'attachment' | 'plan' | 'event' | 'task' | 'empty';

export interface VeyraResultCard {
  resultType: Exclude<VeyraResultType, 'empty'>;
  id: string;
  title: string;
  subtitle?: string;
  senderName?: string;
  chatId?: string;
  chatLabel?: string;
  createdAt?: string;
  sourceLabel?: string;
  deepLink?: { kind: 'chat_message'; chatId: string; messageId: string } | { kind: 'action'; actionId: string };
}

// Structured, server-authoritative follow-up context. The client stores this
// in memory only (never persisted) and echoes it back on the next request;
// the server re-resolves and re-authorizes it every time rather than trusting
// it — see `resolveScopedChat`/`resolvePlanForContext` in veyra-retrieval.ts.
export interface VeyraConversationContext {
  activeSpaceId?: string;
  activeSpaceName?: string;
  activePlanId?: string;
  activePlanTitle?: string;
  activeEventId?: string;
  lastResultKind?: VeyraResultType;
}

export interface VeyraSettingsDocument {
  _id?: ObjectId;
  userId: ObjectId;
  enabled: boolean;
  voiceRepliesEnabled: boolean;
  scopes: Array<{
    id: string;
    type: VeyraScopeType;
    targetId?: ObjectId;
    label?: string;
    grantedAt: Date;
  }>;
  updatedAt: Date;
  createdAt: Date;
}

export interface VeyraAuditDocument {
  _id?: ObjectId;
  userId: ObjectId;
  scopeType: VeyraScopeType;
  intentCategory: VeyraIntentCategory;
  succeeded: boolean;
  createdAt: Date;
}

export function getVeyraSettingsCollection(): Collection<VeyraSettingsDocument> {
  return getDatabase().collection<VeyraSettingsDocument>('veyra_settings');
}

export function getVeyraAuditCollection(): Collection<VeyraAuditDocument> {
  return getDatabase().collection<VeyraAuditDocument>('veyra_audit');
}

export async function createVeyraIndexes(): Promise<void> {
  try {
    await getVeyraSettingsCollection().createIndex({ userId: 1 }, { unique: true, name: 'veyra_user' });
    await getVeyraAuditCollection().createIndex({ userId: 1, createdAt: -1 }, { name: 'veyra_audit_user_created' });
    await getVeyraAuditCollection().createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90, name: 'veyra_audit_ttl' });
    logger.info('Veyra indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create Veyra indexes');
    throw error;
  }
}

export async function getOrCreateVeyraSettings(userId: ObjectId): Promise<VeyraSettingsDocument> {
  const now = new Date();
  const collection = getVeyraSettingsCollection();
  const existing = await collection.findOne({ userId });
  if (existing) return existing;

  const doc: VeyraSettingsDocument = {
    userId,
    enabled: false,
    voiceRepliesEnabled: true,
    scopes: [],
    createdAt: now,
    updatedAt: now,
  };
  await collection.insertOne(doc);
  return doc;
}
