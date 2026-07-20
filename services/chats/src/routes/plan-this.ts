import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { EventType, type MessageEditedEvent, type MessageSentEvent } from '@repo/types';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import { getDatabase } from '../db';
import { getChatsCollection, type Chat } from '../models/chat';
import { getChatActionsCollection, type ChatActionDocument } from '../models/chat-action';
import {
  getPlanThisCollection,
  type PlanThisAssignment,
  type PlanThisDocument,
  type PlanThisSource,
  type PlanThisVoteStatus,
} from '../models/plan-this';
import { getPubSub } from '../pubsub';
import { isChatExpired } from '../serialize-chat';

const SourceSchema = z.object({
  type: z.enum(['post', 'reel']),
  id: z.string().refine(ObjectId.isValid),
});

const DraftSchema = z.object({
  source: SourceSchema,
  chatId: z.string().refine(ObjectId.isValid),
  participantUserIds: z.array(z.string().refine(ObjectId.isValid)).min(1).max(100),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(800),
  suggestedAt: z.string().datetime().optional(),
  suggestedLocation: z.string().max(200).optional(),
  budgetNotes: z.string().max(800).optional(),
  checklist: z.array(z.string().min(1).max(160)).max(12).default([]),
  clientRequestId: z.string().min(1).max(120).optional(),
});

const GenerateDraftSchema = z.object({
  source: SourceSchema,
  note: z.string().max(500).optional(),
});

const VoteSchema = z.object({ status: z.enum(['going', 'maybe', 'not_joining']) });
const UpdateSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().min(1).max(800).optional(),
  suggestedAt: z.string().datetime().nullable().optional(),
  suggestedLocation: z.string().max(200).nullable().optional(),
  budgetNotes: z.string().max(800).nullable().optional(),
  checklist: z.array(z.string().min(1).max(160)).max(12).optional(),
  participantUserIds: z.array(z.string().refine(ObjectId.isValid)).min(1).max(100).optional(),
});
const FinalizeSchema = z.object({
  createEvent: z.boolean().default(true),
  finalDateTime: z.string().optional(),
  reminderEnabled: z.boolean().default(false),
  reminderOffsetMinutes: z.number().int().positive().optional(),
  assignments: z.array(z.object({
    title: z.string().min(1).max(160),
    details: z.string().max(800).optional(),
    dueAt: z.string().datetime().optional(),
    assigneeUserId: z.string().refine(ObjectId.isValid).optional(),
  })).max(12).default([]),
});
const AssignmentResponseSchema = z.object({
  status: z.enum(['accepted', 'declined']),
});

const CLOSED_PLAN_STATES = ['finalized', 'cancelled', 'expired'] as const;
const ALLOWED_REMINDER_OFFSETS = new Set([5, 15, 60, 1440]);

interface UserDoc {
  _id: ObjectId;
  name?: string;
  username?: string;
  email?: string;
  accountStatus?: string;
  deactivatedAt?: Date;
  deletedAt?: Date;
}

function displayName(user?: UserDoc | null) {
  return user?.name || user?.username || 'Someone';
}

async function loadUserNames(userIds: ObjectId[]) {
  const users = await getDatabase()
    .collection<UserDoc>('users')
    .find({ _id: { $in: userIds } }, { projection: { _id: 1, name: 1, username: 1, email: 1 } })
    .toArray();
  return new Map(users.map((user) => [user._id.toString(), displayName(user)]));
}

async function assertActiveUser(userId: ObjectId) {
  const user = await getDatabase().collection<UserDoc>('users').findOne({ _id: userId });
  return Boolean(user && !user.deletedAt && !user.deactivatedAt && user.accountStatus !== 'deactivated' && user.accountStatus !== 'deleted');
}

async function hasBlockBetween(a: ObjectId, b: ObjectId) {
  return Boolean(await getDatabase().collection('user_blocks').findOne({
    $or: [
      { blockerUserId: a, blockedUserId: b },
      { blockerUserId: b, blockedUserId: a },
    ],
  }));
}

async function sendPlanAssignmentInboxNotification(params: {
  recipientId: ObjectId;
  chatId: ObjectId;
  planId: ObjectId;
  assignmentId: string;
  taskTitle: string;
}) {
  const baseUrl = (process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3006').replace(/\/+$/, '');
  try {
    await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: params.recipientId.toString(),
        kind: 'action_reminder',
        title: 'Assignment requested',
        body: `A Plan This task needs your response: ${params.taskTitle}`,
        data: {
          route: `/chats/${params.chatId.toString()}`,
          chatId: params.chatId.toString(),
          planId: params.planId.toString(),
          assignmentId: params.assignmentId,
          target: `/chats/${params.chatId.toString()}`,
        },
      }),
    });
  } catch (error) {
    logger.error({ error, planId: params.planId.toString() }, 'Plan assignment notification failed');
  }
}

async function assertPlanChatAccess(chatId: ObjectId, userId: ObjectId, requireWritable = false) {
  const chat = await getChatsCollection().findOne({ _id: chatId, deletedAt: { $exists: false } });
  if (!chat || !chat.participants.some((id) => id.equals(userId))) return { status: 404 as const, chat: null };
  if (chat.type !== 'direct' && chat.type !== 'group') return { status: 400 as const, chat: null };
  if (chat.type === 'group' && isChatExpired(chat)) return { status: 400 as const, chat: null };
  if (requireWritable) {
    if (chat.sendMode === 'admins_only' && !chat.admins?.some((id) => id.equals(userId)) && !chat.ownerId?.equals(userId)) {
      return { status: 403 as const, chat: null };
    }
    if (chat.memberRestrictions?.some((restriction) => restriction.userId.equals(userId))) return { status: 403 as const, chat: null };
  }
  if (chat.type === 'direct') {
    const other = chat.participants.find((id) => !id.equals(userId));
    if (other && await hasBlockBetween(userId, other)) return { status: 403 as const, chat: null };
  }
  return { status: 200 as const, chat };
}

function chatAccessError(status: 400 | 403 | 404, res: Response) {
  if (status === 400) return res.status(400).json({ error: 'Validation Error', message: 'Conversation is unavailable for Plan This.' });
  if (status === 403) return res.status(403).json({ error: 'Forbidden', message: 'You cannot send to this Conversation right now.' });
  return res.status(404).json({ error: 'Not Found', message: 'Conversation not found.' });
}

async function sourcePreview(source: z.infer<typeof SourceSchema>, userId: ObjectId): Promise<PlanThisSource | null> {
  const db = getDatabase();
  const sourceId = new ObjectId(source.id);
  if (source.type === 'post') {
    const post = await db.collection('posts').findOne({
      _id: sourceId,
      visibility: 'public',
      deletedAt: { $exists: false },
      $or: [{ communityId: { $exists: false } }, { communityId: null }],
    });
    if (!post) return null;
    const author = await db.collection<UserDoc>('users').findOne({ _id: post.authorUserId }, { projection: { name: 1, username: 1 } });
    if (post.authorUserId && await hasBlockBetween(userId, post.authorUserId)) return null;
    return {
      type: 'post',
      sourceId,
      previewLabel: String(post.body || 'Public Blabber post').slice(0, 140),
      creatorLabel: displayName(author),
      topics: Array.isArray(post.discoveryTopicIds) ? post.discoveryTopicIds.slice(0, 5) : [],
    };
  }

  const reel = await db.collection('reels').findOne({
    _id: sourceId,
    visibility: 'public',
    publishState: 'published',
    processingStatus: 'ready',
    reelDiscoverable: true,
    deletedAt: { $exists: false },
    moderationRemovedAt: { $exists: false },
  });
  if (!reel) return null;
  const author = await db.collection<UserDoc>('users').findOne({ _id: reel.authorUserId }, { projection: { name: 1, username: 1 } });
  if (reel.authorUserId && await hasBlockBetween(userId, reel.authorUserId)) return null;
  return {
    type: 'reel',
    sourceId,
    previewLabel: String(reel.caption || 'Public Blabber Reel').slice(0, 140),
    creatorLabel: displayName(author),
    topics: Array.isArray(reel.reelTopicIds) ? reel.reelTopicIds.slice(0, 5) : [],
  };
}

// A finalized Plan's linked Event blocks cancellation only once its start time has passed.
// Plans without a linked Event (or not yet finalized) are cancellable up until they reach a
// terminal state.
function planEventStart(plan: PlanThisDocument): Date | null {
  if (!plan.eventMessageId || !plan.suggestedAt) return null;
  return plan.suggestedAt;
}

function isPlanCancellable(plan: PlanThisDocument, now: Date): boolean {
  if (plan.state === 'cancelled' || plan.state === 'expired') return false;
  const eventStart = planEventStart(plan);
  if (eventStart && eventStart.getTime() <= now.getTime()) return false;
  return true;
}

async function resolvedPlanSource(plan: PlanThisDocument, viewerUserId: ObjectId) {
  const preview = await sourcePreview({ type: plan.source.type, id: plan.source.sourceId.toString() }, viewerUserId);
  if (!preview) {
    return { type: plan.source.type, available: false as const };
  }
  return {
    type: preview.type,
    available: true as const,
    sourceId: plan.source.sourceId.toString(),
    previewLabel: preview.previewLabel,
    creatorLabel: preview.creatorLabel,
    topics: preview.topics || [],
  };
}

async function serializePlan(plan: PlanThisDocument, viewerUserId: ObjectId) {
  const currentPlanVersion = plan.planVersion ?? 0;
  const votes = plan.votes.map((vote) => ({
    userId: vote.userId.toString(),
    status: vote.status,
    planVersion: vote.planVersion ?? 0,
    current: (vote.planVersion ?? 0) === currentPlanVersion,
    updatedAt: vote.updatedAt.toISOString(),
  }));
  const myVote = votes.find((vote) => vote.userId === viewerUserId.toString() && vote.current)?.status || null;
  const now = new Date();
  const source = await resolvedPlanSource(plan, viewerUserId);
  return {
    id: plan._id.toString(),
    chatId: plan.chatId.toString(),
    creatorUserId: plan.creatorUserId.toString(),
    source,
    state: plan.state,
    title: plan.title,
    description: plan.description,
    suggestedAt: plan.suggestedAt?.toISOString() || null,
    suggestedLocation: plan.suggestedLocation || '',
    budgetNotes: plan.budgetNotes || '',
    checklist: plan.checklist,
    participants: plan.participants.filter((participant) => !participant.removedAt).map((participant) => ({
      userId: participant.userId.toString(),
      displayName: participant.displayName,
    })),
    votes,
    myVote,
    assignments: plan.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      details: assignment.details,
      dueAt: assignment.dueAt?.toISOString(),
      assigneeUserId: assignment.assigneeUserId?.toString(),
      status: assignment.status,
      taskStatus: assignment.taskStatus || (
        assignment.status === 'accepted' ? 'accepted' :
        assignment.status === 'declined' ? 'declined' :
        assignment.assigneeUserId ? 'pending_response' : 'unassigned'
      ),
      acceptedBy: assignment.acceptedBy?.toString(),
      acceptedAt: assignment.acceptedAt?.toISOString(),
      declinedAt: assignment.declinedAt?.toISOString(),
      actionId: assignment.actionId?.toString(),
    })),
    proposalMessageId: plan.proposalMessageId?.toString(),
    eventMessageId: plan.eventMessageId?.toString(),
    eventReminderOffsetMinutes: plan.eventReminderOffsetMinutes,
    updateCount: plan.updateCount,
    planVersion: currentPlanVersion,
    lastMaterialChangeAt: plan.lastMaterialChangeAt?.toISOString(),
    finalizedAt: plan.finalizedAt?.toISOString(),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    permissions: {
      canEdit: plan.creatorUserId.equals(viewerUserId) && !CLOSED_PLAN_STATES.includes(plan.state as any),
      canCancel: plan.creatorUserId.equals(viewerUserId) && isPlanCancellable(plan, now),
      canFinalize: plan.creatorUserId.equals(viewerUserId) && !CLOSED_PLAN_STATES.includes(plan.state as any),
      canVote: plan.participants.some((participant) => participant.userId.equals(viewerUserId) && !participant.removedAt) && !CLOSED_PLAN_STATES.includes(plan.state as any),
    },
  };
}

function planMessageBody(plan: Pick<PlanThisDocument, 'title' | 'description'>) {
  return `Plan This proposal: ${plan.title}\n${plan.description}`;
}

function planMessageMetadata(plan: PlanThisDocument, kind: 'proposal' | 'finalized' | 'updated' | 'cancelled') {
  return {
    planId: plan._id,
    kind,
    planVersion: plan.planVersion ?? 0,
    title: plan.title,
    status: plan.state,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

async function publishPlanMessage(chat: Chat, senderId: ObjectId, body: string, planId: ObjectId, kind: 'proposal' | 'finalized' | 'updated') {
  const db = getDatabase();
  const now = new Date();
  const messageDoc: any = {
    _id: new ObjectId(),
    chatId: chat._id,
    senderId,
    type: 'text',
    body,
    planThis: { planId, kind },
    reactions: [],
    status: 'sent',
    deletedFor: [],
    createdAt: now,
  };
  await db.collection('messages').insertOne(messageDoc);
  await db.collection('chats').updateOne(
    { _id: chat._id },
    { $set: { lastMessageRef: { messageId: messageDoc._id, body, senderId, createdAt: now }, updatedAt: now } }
  );
  try {
    const sender = await db.collection<UserDoc>('users').findOne({ _id: senderId }, { projection: { name: 1, username: 1 } });
    await getPubSub().publish(createEvent<MessageSentEvent>(EventType.MESSAGE_SENT, {
      messageId: messageDoc._id.toString(),
      chatId: chat._id.toString(),
      senderId: senderId.toString(),
      senderName: displayName(sender),
      content: body,
      chatType: chat.type,
      chatTitle: chat.title,
      participants: chat.participants.map((id) => id.toString()),
      message: {
        ...messageDoc,
        _id: messageDoc._id.toString(),
        chatId: chat._id.toString(),
        senderId: senderId.toString(),
        planThis: {
          planId: planId.toString(),
          kind,
        },
        createdAt: now.toISOString(),
      },
      createdAt: now.toISOString(),
    }));
  } catch (error) {
    logger.error({ error, planId: planId.toString() }, 'Failed to publish Plan This message');
  }
  return messageDoc._id as ObjectId;
}

async function publishPlanMessageEdited(chat: Chat, messageId: ObjectId, plan: PlanThisDocument, kind: 'proposal' | 'finalized' | 'updated' | 'cancelled') {
  const now = new Date();
  const body = planMessageBody(plan);
  await getDatabase().collection('messages').updateOne(
    { _id: messageId, chatId: chat._id },
    {
      $set: {
        body,
        planThis: planMessageMetadata({ ...plan, updatedAt: now }, kind),
        editedAt: now,
      },
    } as any
  );
  try {
    await getPubSub().publish(createEvent<MessageEditedEvent>(EventType.MESSAGE_EDITED, {
      messageId: messageId.toString(),
      chatId: chat._id.toString(),
      senderId: plan.creatorUserId.toString(),
      content: body,
      chatType: chat.type,
      chatTitle: chat.title,
      participants: chat.participants.map((id) => id.toString()),
      message: {
        _id: messageId.toString(),
        chatId: chat._id.toString(),
        senderId: plan.creatorUserId.toString(),
        type: 'text',
        body,
        planThis: {
          planId: plan._id.toString(),
          kind,
          planVersion: plan.planVersion ?? 0,
          title: plan.title,
          status: plan.state,
          createdAt: plan.createdAt.toISOString(),
          updatedAt: now.toISOString(),
        },
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: plan.createdAt.toISOString(),
        editedAt: now.toISOString(),
      },
      editedAt: now.toISOString(),
    }));
  } catch (error) {
    logger.error({ error, planId: plan._id.toString() }, 'Failed to publish Plan This card update');
  }
}

function serializeEventMessageForRealtime(doc: any) {
  return {
    ...doc,
    _id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    senderId: doc.senderId?.toString ? doc.senderId.toString() : doc.senderId,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    editedAt: doc.editedAt instanceof Date ? doc.editedAt.toISOString() : doc.editedAt,
    event: doc.event
      ? {
          ...doc.event,
          createdBy: doc.event.createdBy?.toString ? doc.event.createdBy.toString() : doc.event.createdBy,
          cancelledBy: doc.event.cancelledBy?.toString ? doc.event.cancelledBy.toString() : doc.event.cancelledBy,
          cancelledAt: doc.event.cancelledAt instanceof Date ? doc.event.cancelledAt.toISOString() : doc.event.cancelledAt,
          rsvps: (doc.event.rsvps || []).map((rsvp: any) => ({
            ...rsvp,
            userId: rsvp.userId?.toString ? rsvp.userId.toString() : rsvp.userId,
          })),
        }
      : undefined,
  };
}

// Cancels the Blabber Event message a finalized Plan created, so the reminder processor (which
// filters on event.cancelledAt) stops sending future reminders and the chat's event card reflects
// the cancellation. Realtime is best-effort; a manual refresh always reflects the persisted state.
async function cancelPlanEventMessage(chat: Chat, eventMessageId: ObjectId, cancelledBy: ObjectId) {
  const now = new Date();
  const updated = await getDatabase().collection('messages').findOneAndUpdate(
    { _id: eventMessageId, chatId: chat._id, 'event.cancelledAt': { $exists: false } },
    { $set: { 'event.cancelledAt': now, 'event.cancelledBy': cancelledBy, editedAt: now } },
    { returnDocument: 'after' }
  );
  if (!updated) return;
  try {
    await getPubSub().publish(createEvent<MessageEditedEvent>(EventType.MESSAGE_EDITED, {
      messageId: updated._id.toString(),
      chatId: chat._id.toString(),
      senderId: updated.senderId?.toString ? updated.senderId.toString() : String(updated.senderId),
      content: updated.body,
      chatType: chat.type,
      chatTitle: chat.title,
      participants: chat.participants.map((id) => id.toString()),
      message: serializeEventMessageForRealtime(updated),
      editedAt: now.toISOString(),
    }));
  } catch (error) {
    logger.error({ error, messageId: eventMessageId.toString() }, 'Failed to publish Plan This Event cancellation update');
  }
}

async function loadPlanForParticipant(planId: string, userId: ObjectId, requireWritable = false) {
  if (!ObjectId.isValid(planId)) return { status: 400 as const, plan: null, chat: null };
  const plan = await getPlanThisCollection().findOne({ _id: new ObjectId(planId) });
  if (!plan) return { status: 404 as const, plan: null, chat: null };
  const access = await assertPlanChatAccess(plan.chatId, userId, requireWritable);
  if (access.status !== 200) return { status: access.status, plan: null, chat: null };
  const eligible = plan.creatorUserId.equals(userId) || plan.participants.some((participant) => participant.userId.equals(userId) && !participant.removedAt);
  if (!eligible) return { status: 404 as const, plan: null, chat: null };
  return { status: 200 as const, plan, chat: access.chat };
}

export const getPlanThisEligibility = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = SourceSchema.safeParse({ type: req.query.type, id: req.query.id });
  if (!parsed.success) return res.status(400).json({ eligible: false });
  const userObjectId = new ObjectId(userId);
  const preview = await sourcePreview(parsed.data, userObjectId);
  return res.status(200).json({ eligible: Boolean(preview), source: preview ? { type: preview.type, previewLabel: preview.previewLabel, creatorLabel: preview.creatorLabel, topics: preview.topics || [] } : null });
});

export const listPlanDestinations = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  const chats = await getChatsCollection().find({ participants: userObjectId, deletedAt: { $exists: false } }).sort({ updatedAt: -1 }).limit(80).toArray();
  const activeChats = [];
  for (const chat of chats) {
    const access = await assertPlanChatAccess(chat._id, userObjectId, true);
    if (access.status === 200 && access.chat) activeChats.push(access.chat);
  }
  const userIds = Array.from(new Set(activeChats.flatMap((chat) => chat.participants.map((id) => id.toString())))).map((id) => new ObjectId(id));
  const names = await loadUserNames(userIds);
  const destinations = activeChats.map((chat) => {
    const other = chat.type === 'direct' ? chat.participants.find((id) => !id.equals(userObjectId)) : null;
    return {
      id: chat._id.toString(),
      type: chat.type,
      name: chat.type === 'direct' ? `Direct chat with ${other ? names.get(other.toString()) || 'Someone' : 'Someone'}` : chat.title || 'Group chat',
      avatarUrl: chat.avatarUrl,
      memberCount: chat.type === 'group' ? chat.participants.length : undefined,
      participants: chat.participants.map((id) => ({ userId: id.toString(), displayName: names.get(id.toString()) || 'Someone' })),
    };
  });
  return res.status(200).json({ destinations });
});

export const generatePlanDraft = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const settings = await getDatabase().collection('userSettings').findOne({ userId: new ObjectId(userId) });
  if (settings?.chatIntelligenceEnabled === false) {
    return res.status(403).json({ error: 'Forbidden', message: 'Turn on AI features in Privacy settings to use draft generation.' });
  }
  const parsed = GenerateDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid draft request.' });
  const preview = await sourcePreview(parsed.data.source, new ObjectId(userId));
  if (!preview) return res.status(404).json({ error: 'Not Found', message: 'This source is not available for Plan This.' });

  const noun = preview.type === 'reel' ? 'Reel' : 'post';
  return res.status(200).json({
    draft: {
      title: `Plan this ${noun}`,
      description: [preview.previewLabel, parsed.data.note].filter(Boolean).join(' - ').slice(0, 800),
      suggestedLocation: '',
      budgetNotes: '',
      checklist: ['Confirm who is joining', 'Pick a time', 'Handle booking or logistics'],
      aiContextUsed: {
        sourceType: preview.type,
        captionOrTitle: preview.previewLabel,
        controlledTopics: preview.topics || [],
        safeCreatorDisplayLabel: preview.creatorLabel || 'Creator',
        userEnteredNoteIncluded: Boolean(parsed.data.note),
      },
    },
  });
});

export const createPlanProposal = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = DraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid Plan This proposal.' });
  const userObjectId = new ObjectId(userId);
  if (!await assertActiveUser(userObjectId)) return res.status(403).json({ error: 'Forbidden', message: 'Account is not active.' });
  const access = await assertPlanChatAccess(new ObjectId(parsed.data.chatId), userObjectId, true);
  if (access.status !== 200 || !access.chat) return chatAccessError(access.status, res);
  const chat = access.chat;

  // Idempotency: a retried/double-submitted request with the same client request ID replays
  // the plan that was already created instead of sending a second proposal message.
  const clientRequestId = parsed.data.clientRequestId;
  if (clientRequestId) {
    const existingByRequestId = await getPlanThisCollection().findOne({
      chatId: chat._id,
      creatorUserId: userObjectId,
      clientRequestId,
    });
    if (existingByRequestId) {
      return res.status(200).json({ plan: await serializePlan(existingByRequestId, userObjectId) });
    }
  }

  const source = await sourcePreview(parsed.data.source, userObjectId);
  if (!source) return res.status(404).json({ error: 'Not Found', message: 'This source is not available for Plan This.' });
  const activeParticipantIds = parsed.data.participantUserIds
    .map((id) => new ObjectId(id))
    .filter((id) => chat.participants.some((participantId) => participantId.equals(id)));
  if (activeParticipantIds.length === 0) return res.status(400).json({ error: 'Validation Error', message: 'Choose at least one current participant.' });
  const names = await loadUserNames(activeParticipantIds);
  const now = new Date();
  const plan: PlanThisDocument = {
    _id: new ObjectId(),
    chatId: chat._id,
    creatorUserId: userObjectId,
    // Only set the key when it's an actual string — never write an explicit null/undefined,
    // which the partial index intentionally excludes.
    ...(clientRequestId ? { clientRequestId } : {}),
    source,
    state: 'voting',
    title: parsed.data.title,
    description: parsed.data.description,
    suggestedAt: parsed.data.suggestedAt ? new Date(parsed.data.suggestedAt) : undefined,
    suggestedLocation: parsed.data.suggestedLocation,
    budgetNotes: parsed.data.budgetNotes,
    checklist: parsed.data.checklist,
    participants: activeParticipantIds.map((id) => ({ userId: id, displayName: names.get(id.toString()) })),
    votes: [],
    assignments: [],
    updateCount: 0,
    planVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await getPlanThisCollection().insertOne(plan);
  } catch (error: any) {
    if (error?.code === 11000 && clientRequestId) {
      // Concurrent duplicate submission raced us; the other request's plan already exists.
      const raced = await getPlanThisCollection().findOne({ chatId: chat._id, creatorUserId: userObjectId, clientRequestId });
      if (raced) return res.status(200).json({ plan: await serializePlan(raced, userObjectId) });
    }
    throw error;
  }
  const body = planMessageBody(plan);
  const messageId = await publishPlanMessage(chat, userObjectId, body, plan._id, 'proposal');
  const updated = await getPlanThisCollection().findOneAndUpdate(
    { _id: plan._id },
    {
      $set: {
        proposalMessageId: messageId,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );
  await getDatabase().collection('messages').updateOne(
    { _id: messageId },
    { $set: { planThis: planMessageMetadata(updated!, 'proposal') } } as any
  );
  return res.status(201).json({ plan: await serializePlan(updated!, userObjectId) });
});

export const getPlan = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const result = await loadPlanForParticipant(req.params.planId, new ObjectId(userId));
  if (result.status !== 200 || !result.plan) return chatAccessError(result.status, res);
  return res.status(200).json({ plan: await serializePlan(result.plan, new ObjectId(userId)) });
});

export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  const result = await loadPlanForParticipant(req.params.planId, userObjectId, true);
  if (result.status !== 200 || !result.plan || !result.chat) return chatAccessError(result.status, res);
  if (!result.plan.creatorUserId.equals(userObjectId)) return res.status(403).json({ error: 'Forbidden', message: 'Only the plan creator can update this proposal.' });
  if (['finalized', 'cancelled', 'expired'].includes(result.plan.state)) return res.status(400).json({ error: 'Validation Error', message: 'This plan is no longer editable.' });
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid plan update.' });
  const previousParticipantIds = new Set(result.plan.participants.filter((participant) => !participant.removedAt).map((participant) => participant.userId.toString()));
  const materialSuggestedAtChanged =
    parsed.data.suggestedAt !== undefined &&
    (parsed.data.suggestedAt ? new Date(parsed.data.suggestedAt).toISOString() : null) !== (result.plan.suggestedAt?.toISOString() || null);
  const materialLocationChanged =
    parsed.data.suggestedLocation !== undefined &&
    (parsed.data.suggestedLocation || '') !== (result.plan.suggestedLocation || '');
  let participantsChanged = false;
  const set: Partial<PlanThisDocument> = { updatedAt: new Date(), updateCount: result.plan.updateCount + 1, state: 'voting' };
  if (parsed.data.title !== undefined) set.title = parsed.data.title;
  if (parsed.data.description !== undefined) set.description = parsed.data.description;
  if (parsed.data.suggestedAt !== undefined) set.suggestedAt = parsed.data.suggestedAt ? new Date(parsed.data.suggestedAt) : undefined;
  if (parsed.data.suggestedLocation !== undefined) set.suggestedLocation = parsed.data.suggestedLocation || undefined;
  if (parsed.data.budgetNotes !== undefined) set.budgetNotes = parsed.data.budgetNotes || undefined;
  if (parsed.data.checklist !== undefined) set.checklist = parsed.data.checklist;
  if (parsed.data.participantUserIds !== undefined) {
    const requested = new Set(parsed.data.participantUserIds);
    const nextParticipants = result.plan.participants.map((participant) => {
      if (participant.removedAt) return participant;
      if (requested.has(participant.userId.toString())) return participant;
      return { ...participant, removedAt: new Date() };
    });
    const nextActive = new Set(nextParticipants.filter((participant) => !participant.removedAt).map((participant) => participant.userId.toString()));
    if (nextActive.size === 0) return res.status(400).json({ error: 'Validation Error', message: 'Choose at least one current participant.' });
    participantsChanged = nextActive.size !== previousParticipantIds.size || Array.from(previousParticipantIds).some((id) => !nextActive.has(id));
    set.participants = nextParticipants;
  }
  const materialChanged = materialSuggestedAtChanged || materialLocationChanged || participantsChanged;
  if (materialChanged) {
    set.planVersion = (result.plan.planVersion ?? 0) + 1;
    set.lastMaterialChangeAt = new Date();
  }
  const updated = await getPlanThisCollection().findOneAndUpdate({ _id: result.plan._id }, { $set: set }, { returnDocument: 'after' });
  if (updated?.proposalMessageId) await publishPlanMessageEdited(result.chat, updated.proposalMessageId, updated, 'updated');
  return res.status(200).json({ plan: await serializePlan(updated!, userObjectId) });
});

export const votePlan = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  const parsed = VoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid vote.' });
  const result = await loadPlanForParticipant(req.params.planId, userObjectId);
  if (result.status !== 200 || !result.plan) return chatAccessError(result.status, res);
  if (CLOSED_PLAN_STATES.includes(result.plan.state as any)) return res.status(400).json({ error: 'Validation Error', message: 'Voting is closed.' });
  if (!result.plan.participants.some((participant) => participant.userId.equals(userObjectId) && !participant.removedAt)) {
    return res.status(403).json({ error: 'Forbidden', message: 'You cannot vote on this plan.' });
  }
  const votes = [
    ...result.plan.votes.filter((vote) => !vote.userId.equals(userObjectId)),
    { userId: userObjectId, status: parsed.data.status as PlanThisVoteStatus, planVersion: result.plan.planVersion ?? 0, updatedAt: new Date() },
  ];
  const eligibleCount = result.plan.participants.filter((participant) => !participant.removedAt).length;
  const currentVoteCount = votes.filter((vote) => (vote.planVersion ?? 0) === (result.plan.planVersion ?? 0)).length;
  const state = currentVoteCount >= eligibleCount ? 'ready_to_finalize' : 'voting';
  const updated = await getPlanThisCollection().findOneAndUpdate(
    { _id: result.plan._id },
    { $set: { votes, state, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (updated?.proposalMessageId && result.chat) await publishPlanMessageEdited(result.chat, updated.proposalMessageId, updated, 'updated');
  return res.status(200).json({ plan: await serializePlan(updated!, userObjectId) });
});

export const finalizePlan = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  const parsed = FinalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid finalization request.' });
  const result = await loadPlanForParticipant(req.params.planId, userObjectId, true);
  if (result.status !== 200 || !result.plan || !result.chat) return chatAccessError(result.status, res);
  if (!result.plan.creatorUserId.equals(userObjectId)) return res.status(403).json({ error: 'Forbidden', message: 'Only the plan creator can finalize.' });
  if (result.plan.state === 'finalized') {
    return res.status(200).json({ plan: await serializePlan(result.plan, userObjectId) });
  }
  if (result.plan.state === 'cancelled' || result.plan.state === 'expired') return res.status(400).json({ error: 'Validation Error', message: 'Plan is closed.' });
  const now = new Date();
  const finalDateTime = parsed.data.finalDateTime ? new Date(parsed.data.finalDateTime) : result.plan.suggestedAt;
  const wantsReminder = Boolean(parsed.data.reminderEnabled || parsed.data.reminderOffsetMinutes);
  if (wantsReminder && !parsed.data.createEvent) {
    return res.status(400).json({ error: 'Validation Error', message: 'A reminder requires a Blabber Event.' });
  }
  if (parsed.data.createEvent) {
    if (!finalDateTime || Number.isNaN(finalDateTime.getTime())) {
      return res.status(400).json({ error: 'Validation Error', message: 'A date and time are required to create a Blabber Event.' });
    }
    if (finalDateTime.getTime() <= now.getTime()) {
      return res.status(400).json({ error: 'Validation Error', message: 'Choose a future date and time for this Event.' });
    }
  }
  let reminderOffsetMinutes: number | undefined;
  if (wantsReminder) {
    if (!parsed.data.reminderOffsetMinutes || !ALLOWED_REMINDER_OFFSETS.has(parsed.data.reminderOffsetMinutes)) {
      return res.status(400).json({ error: 'Validation Error', message: 'Choose a supported Event reminder.' });
    }
    reminderOffsetMinutes = parsed.data.reminderOffsetMinutes;
    if (!finalDateTime || finalDateTime.getTime() - now.getTime() < reminderOffsetMinutes * 60_000) {
      return res.status(400).json({ error: 'Validation Error', message: 'Choose an Event time far enough in the future for the selected reminder.' });
    }
  }
  let eventMessageId: ObjectId | undefined;
  if (parsed.data.createEvent && finalDateTime) {
    const currentVersion = result.plan.planVersion ?? 0;
    const goingUserIds = result.plan.votes
      .filter((vote) => (vote.planVersion ?? 0) === currentVersion && vote.status === 'going')
      .map((vote) => vote.userId.toString());
    const rsvpUserIds = Array.from(new Set([userObjectId.toString(), ...goingUserIds]))
      .map((id) => new ObjectId(id))
      .filter((id) => result.chat!.participants.some((participant) => participant.equals(id)));
    eventMessageId = await publishPlanMessage(result.chat, userObjectId, `Event: ${result.plan.title}\n${result.plan.suggestedLocation || ''}`, result.plan._id, 'finalized');
    await getDatabase().collection('messages').updateOne(
      { _id: eventMessageId },
      {
        $set: {
          type: 'event',
          event: {
            title: result.plan.title,
            startsAt: finalDateTime.toISOString(),
            startAt: finalDateTime,
            timezone: 'UTC',
            location: result.plan.suggestedLocation,
            description: result.plan.description,
            createdBy: userObjectId,
            updatedAt: now,
            reminderEnabled: Boolean(reminderOffsetMinutes),
            reminderOffsetMinutes,
            rsvps: rsvpUserIds.map((rsvpUserId) => ({ userId: rsvpUserId, status: 'going', respondedAt: now, updatedAt: now })),
          },
        },
      }
    );
  }
  const names = await loadUserNames([userObjectId, ...result.chat.participants]);
  const assignments: PlanThisAssignment[] = [];
  for (const item of parsed.data.assignments) {
    const assignee = item.assigneeUserId ? new ObjectId(item.assigneeUserId) : undefined;
    if (assignee && !result.chat.participants.some((participant) => participant.equals(assignee))) continue;
    if (assignee && !await assertActiveUser(assignee)) continue;
    if (assignee && await hasBlockBetween(userObjectId, assignee)) continue;
    const actionId = new ObjectId();
    const assignmentId = new ObjectId().toString();
    const assignedToCreator = Boolean(assignee?.equals(userObjectId));
    const assignmentStatus = assignee && !assignedToCreator ? 'requested' : assignedToCreator ? 'accepted' : 'requested';
    const taskStatus = assignee && !assignedToCreator ? 'pending_response' : assignedToCreator ? 'accepted' : 'unassigned';
    const dueAt = item.dueAt ? new Date(item.dueAt) : undefined;
    const doc: ChatActionDocument = {
      _id: actionId,
      chatId: result.plan.chatId,
      actionKey: `plan-this:${result.plan._id.toString()}:${assignmentId}`,
      type: 'task',
      title: item.title,
      description: item.details || `Requested from Plan This: ${result.plan.title}`,
      assignedTo: assignee ? { userId: assignee.toString(), name: names.get(assignee.toString()) } : undefined,
      createdBy: { userId, name: names.get(userId) },
      dueAt,
      status: 'open',
      visibility: result.chat.type === 'direct' ? 'personal' : 'chat',
      personalOwnerUserId: result.chat.type === 'direct' ? (assignee || userObjectId) : undefined,
      sourceMessageIds: result.plan.proposalMessageId ? [result.plan.proposalMessageId] : [],
      metadata: { origin: 'plan_this', planId: result.plan._id.toString(), assignmentId, assignmentStatus, taskStatus },
      generatedByUserId: userObjectId,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      updates: [],
      activity: [{ id: new ObjectId().toString(), type: 'created', actor: { userId, name: names.get(userId) }, message: assignee && !assignedToCreator ? 'Requested from Plan This' : 'Created from Plan This', createdAt: now.toISOString() }],
    };
    await getChatActionsCollection().insertOne(doc);
    assignments.push({
      id: assignmentId,
      title: item.title,
      details: item.details,
      dueAt,
      assigneeUserId: assignee,
      status: assignmentStatus,
      taskStatus,
      acceptedBy: assignedToCreator ? userObjectId : undefined,
      acceptedAt: assignedToCreator ? now : undefined,
      actionId,
      createdAt: now,
      updatedAt: now,
    });
    if (assignee && !assignedToCreator) {
      void sendPlanAssignmentInboxNotification({
        recipientId: assignee,
        chatId: result.plan.chatId,
        planId: result.plan._id,
        assignmentId,
        taskTitle: item.title,
      });
    }
  }
  const finalizeSet: Partial<PlanThisDocument> = { state: 'finalized', finalizedAt: now, eventMessageId, eventReminderOffsetMinutes: reminderOffsetMinutes, assignments, updatedAt: now };
  if (parsed.data.createEvent) finalizeSet.suggestedAt = finalDateTime;
  const updated = await getPlanThisCollection().findOneAndUpdate(
    { _id: result.plan._id },
    { $set: finalizeSet },
    { returnDocument: 'after' }
  );
  if (updated?.proposalMessageId) await publishPlanMessageEdited(result.chat, updated.proposalMessageId, updated, 'finalized');
  return res.status(200).json({ plan: await serializePlan(updated!, userObjectId) });
});

export const cancelPlan = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  const result = await loadPlanForParticipant(req.params.planId, userObjectId, true);
  if (result.status !== 200 || !result.plan || !result.chat) return chatAccessError(result.status, res);
  if (!result.plan.creatorUserId.equals(userObjectId)) return res.status(403).json({ error: 'Forbidden', message: 'Only the plan creator can cancel.' });

  // Idempotent: a retried/double-clicked cancel on an already-cancelled plan is a no-op success,
  // not an error, so double submits never produce duplicate cancellations or side effects.
  if (result.plan.state === 'cancelled') {
    return res.status(200).json({ plan: await serializePlan(result.plan, userObjectId) });
  }
  if (result.plan.state === 'expired') {
    return res.status(400).json({ error: 'Validation Error', message: 'Plan is closed.' });
  }
  const now = new Date();
  if (!isPlanCancellable(result.plan, now)) {
    return res.status(400).json({ error: 'Validation Error', message: "This plan's Event has already started, so it can no longer be cancelled." });
  }

  // Atomic guard: only transition out of a still-open state. If a concurrent request already
  // cancelled the plan, treat this one as an idempotent replay of that outcome.
  const updated = await getPlanThisCollection().findOneAndUpdate(
    { _id: result.plan._id, state: { $nin: ['cancelled', 'expired'] as any } },
    { $set: { state: 'cancelled', cancelledAt: now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    const current = await getPlanThisCollection().findOne({ _id: result.plan._id });
    return res.status(200).json({ plan: await serializePlan(current || result.plan, userObjectId) });
  }

  // Withdraw pending assignment requests and cancel accepted-but-incomplete tasks on the plan
  // document itself; completed tasks are left untouched so their history is preserved.
  const cancelledAssignments = updated.assignments.map((assignment) =>
    assignment.taskStatus === 'completed' ? assignment : { ...assignment, taskStatus: 'cancelled' as const, updatedAt: now }
  );
  const withEventCancelled = await getPlanThisCollection().findOneAndUpdate(
    { _id: updated._id },
    { $set: { assignments: cancelledAssignments, updatedAt: now } },
    { returnDocument: 'after' }
  ) || updated;

  // Remove active Plan-created tasks from My Actions; never touch unrelated manually created
  // tasks (scoped strictly to this plan's own actions) and never touch already-completed ones.
  const actor = { userId, name: (await loadUserNames([userObjectId])).get(userId) };
  await getChatActionsCollection().updateMany(
    {
      'metadata.origin': 'plan_this',
      'metadata.planId': result.plan._id.toString(),
      deletedAt: { $exists: false },
      status: { $ne: 'completed' as any },
    },
    {
      $set: { deletedAt: now, deletedBy: actor, updatedAt: now, lastActivityAt: now, 'metadata.planStatus': 'cancelled' },
      $push: {
        activity: {
          id: new ObjectId().toString(),
          type: 'edited',
          actor,
          message: 'Withdrawn: Plan This was cancelled',
          createdAt: now.toISOString(),
        },
      },
    } as any
  );

  if (withEventCancelled.eventMessageId) {
    await cancelPlanEventMessage(result.chat, withEventCancelled.eventMessageId, userObjectId);
  }
  if (withEventCancelled.proposalMessageId) await publishPlanMessageEdited(result.chat, withEventCancelled.proposalMessageId, withEventCancelled, 'cancelled');
  return res.status(200).json({ plan: await serializePlan(withEventCancelled, userObjectId) });
});

export const respondToAssignment = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = AssignmentResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid assignment response.' });
  const userObjectId = new ObjectId(userId);
  const result = await loadPlanForParticipant(req.params.planId, userObjectId);
  if (result.status !== 200 || !result.plan) return chatAccessError(result.status, res);
  if (result.plan.state === 'cancelled' || result.plan.state === 'expired') {
    return res.status(400).json({ error: 'Validation Error', message: 'This plan was cancelled and its assignment requests are no longer available.' });
  }
  const assignment = result.plan.assignments.find((item) => item.id === req.params.assignmentId);
  if (!assignment || !assignment.assigneeUserId?.equals(userObjectId)) return res.status(404).json({ error: 'Not Found', message: 'Assignment not found.' });
  if (assignment.taskStatus === 'cancelled') {
    return res.status(400).json({ error: 'Validation Error', message: 'This assignment was withdrawn and is no longer available.' });
  }
  const now = new Date();
  const assignments = result.plan.assignments.map((item) => item.id === assignment.id ? {
    ...item,
    status: parsed.data.status,
    taskStatus: parsed.data.status,
    acceptedBy: parsed.data.status === 'accepted' ? userObjectId : item.acceptedBy,
    acceptedAt: parsed.data.status === 'accepted' ? now : item.acceptedAt,
    declinedAt: parsed.data.status === 'declined' ? now : item.declinedAt,
    updatedAt: now,
  } : item);
  if (assignment.actionId) {
    await getChatActionsCollection().updateOne(
      { _id: assignment.actionId, 'assignedTo.userId': userId },
      {
        $set: {
          'metadata.assignmentStatus': parsed.data.status,
          'metadata.taskStatus': parsed.data.status,
          updatedAt: now,
          lastActivityAt: now,
        },
      }
    );
  }
  const updated = await getPlanThisCollection().findOneAndUpdate({ _id: result.plan._id }, { $set: { assignments, updatedAt: now } }, { returnDocument: 'after' });
  if (updated?.proposalMessageId && result.chat) await publishPlanMessageEdited(result.chat, updated.proposalMessageId, updated, 'updated');
  return res.status(200).json({ plan: await serializePlan(updated!, userObjectId) });
});
