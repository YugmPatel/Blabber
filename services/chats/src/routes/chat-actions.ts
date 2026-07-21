import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import {
  AddChatActionUpdateDTOSchema,
  CreateChatActionDTOSchema,
  DeleteChatActionDTOSchema,
  EventType,
  ChatActionExtractionResultSchema,
  ExtractChatActionsDTOSchema,
  UpdateChatActionDTOSchema,
  type ActionCreatedEvent,
  type ActionUpdatedEvent,
  type ChatActionExtractionResult,
  type ChatActionItem,
  type ChatActionPerson,
  type ChatActionStatus,
} from '@repo/types';
import { getChatsCollection } from '../models/chat';
import {
  getChatActionsCollection,
  type ChatActionDocument,
} from '../models/chat-action';
import { getPlanThisCollection, type PlanThisDocument } from '../models/plan-this';
import { getDatabase } from '../db';
import {
  createActionExtractionService,
  type ActionInputMessage,
  type ActionParticipant,
} from '../intelligence/action-extraction-service';
import { getPubSub } from '../pubsub';
import { isChatExpired } from '../serialize-chat';
import { materializeItemSources } from '../intelligence-source-materializer';
import {
  buildActionsDigestEmail,
  remainingDigestActions,
  sendActionsDigestEmail,
  type DigestActionItem,
} from '../actions-email-digest';
import {
  defaultActionEmailDigestPreference,
  getActionEmailDigestPreferencesCollection,
  type ActionEmailDigestPreferenceDocument,
} from '../models/action-email-digest-preference';

interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  type?: string;
  body: string;
  createdAt: Date;
  deletedFor: ObjectId[];
}

interface UserDocument {
  _id: ObjectId;
  username?: string;
  email?: string;
  name?: string;
}

type MyVisibleActionItem = ChatActionItem & {
  chatTitle?: string;
  chatAvatarUrl?: string;
  chatType?: 'direct' | 'group';
  chatEndedAt?: string;
};

interface ActionEmailDigestPreferenceResponse {
  enabled: boolean;
  hourLocal: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

function assertObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function personName(user: UserDocument): string {
  return user.name || user.username || user.email || user._id.toString();
}

function serializeDate(value?: Date): string | undefined {
  return value ? value.toISOString() : undefined;
}

function serializeActionEmailDigestPreference(preference: ActionEmailDigestPreferenceDocument): ActionEmailDigestPreferenceResponse {
  return {
    enabled: preference.enabled,
    hourLocal: preference.hourLocal,
    timezone: preference.timezone,
    createdAt: preference.createdAt.toISOString(),
    updatedAt: preference.updatedAt.toISOString(),
  };
}

async function getOrCreateActionEmailDigestPreference(userObjectId: ObjectId): Promise<ActionEmailDigestPreferenceDocument> {
  const collection = getActionEmailDigestPreferencesCollection();
  const existing = await collection.findOne({ userId: userObjectId });
  if (existing) return existing;

  const preference = defaultActionEmailDigestPreference(userObjectId);
  try {
    await collection.insertOne(preference);
    return preference;
  } catch (error: any) {
    if (error?.code === 11000) {
      const createdByOtherRequest = await collection.findOne({ userId: userObjectId });
      if (createdByOtherRequest) return createdByOtherRequest;
    }
    throw error;
  }
}

function validateActionEmailDigestPreferencePatch(body: unknown): {
  ok: true;
  value: { enabled?: boolean; hourLocal?: number; timezone?: string };
} | {
  ok: false;
  message: string;
} {
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const value: { enabled?: boolean; hourLocal?: number; timezone?: string } = {};

  if ('enabled' in payload) {
    if (typeof payload.enabled !== 'boolean') return { ok: false, message: 'enabled must be a boolean' };
    value.enabled = payload.enabled;
  }

  if ('hourLocal' in payload) {
    if (!Number.isInteger(payload.hourLocal) || Number(payload.hourLocal) < 0 || Number(payload.hourLocal) > 23) {
      return { ok: false, message: 'hourLocal must be an integer from 0 to 23' };
    }
    value.hourLocal = Number(payload.hourLocal);
  }

  if ('timezone' in payload) {
    if (typeof payload.timezone !== 'string') return { ok: false, message: 'timezone must be a non-empty string' };
    const timezone = payload.timezone.trim();
    if (!timezone || timezone.length > 100 || /[\r\n\t]/.test(timezone)) {
      return { ok: false, message: 'timezone must be a non-empty string under 100 characters' };
    }
    value.timezone = timezone;
  }

  return { ok: true, value };
}

function permissionsForAction(
  action: ChatActionDocument,
  chat: { admins?: ObjectId[]; ownerId?: ObjectId },
  userObjectId: ObjectId
) {
  return {
    canUpdateStatus: canUpdateActionStatus(action, chat, userObjectId),
    canEdit: canManageAction(action, chat, userObjectId),
    canDelete: canDeleteAction(action, chat, userObjectId),
  };
}

function actionVisibility(doc: ChatActionDocument): 'chat' | 'personal' {
  return doc.visibility === 'personal' ? 'personal' : 'chat';
}

function isStandaloneMyAction(action: ChatActionDocument): boolean {
  return actionVisibility(action) === 'personal' && action.metadata?.origin === 'manual_my_actions';
}

function isPersonalActionOwnedBy(action: ChatActionDocument, userObjectId: ObjectId): boolean {
  return actionVisibility(action) === 'personal' && Boolean(action.personalOwnerUserId?.equals(userObjectId));
}

function permissionsForPersonalAction(action: ChatActionDocument, userObjectId: ObjectId): ChatActionItem['permissions'] {
  const isOwner = isPersonalActionOwnedBy(action, userObjectId);
  return {
    canUpdateStatus: isOwner,
    canEdit: isOwner && isStandaloneMyAction(action),
    canDelete: isOwner,
  };
}

function permissionsForVisibleAction(
  action: ChatActionDocument,
  chat: { admins?: ObjectId[]; ownerId?: ObjectId },
  userObjectId: ObjectId
): ChatActionItem['permissions'] {
  if (actionVisibility(action) === 'personal') {
    return permissionsForPersonalAction(action, userObjectId);
  }
  return permissionsForAction(action, chat, userObjectId);
}

function toActionItem(doc: ChatActionDocument, permissions?: ChatActionItem['permissions']): ChatActionItem {
  const status = normalizeActionStatus(doc.status);
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    type: doc.type,
    title: doc.title,
    description: doc.description,
    assignedTo: doc.assignedTo,
    createdBy: doc.createdBy,
    dueDate: doc.dueDate,
    dueAt: serializeDate(doc.dueAt),
    eventStart: doc.eventStart,
    eventEnd: doc.eventEnd,
    status,
    priority: doc.priority,
    visibility: doc.visibility,
    personalOwnerUserId: doc.personalOwnerUserId?.toString(),
    confidence: doc.confidence,
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: doc.sourceText,
    updates: doc.updates ?? [],
    activity: doc.activity ?? [],
    completedAt: serializeDate(doc.completedAt),
    completedBy: doc.completedBy,
    lastActivityAt: serializeDate(doc.lastActivityAt),
    metadata: doc.metadata,
    permissions,
    deletedAt: serializeDate(doc.deletedAt),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function withMyActionsContext(action: ChatActionItem) {
  return {
    ...action,
    chatTitle: 'My Actions',
    chatType: undefined,
  };
}

function currentPlanVotes(plan: PlanThisDocument) {
  const version = plan.planVersion ?? 0;
  return plan.votes.filter((vote) => (vote.planVersion ?? 0) === version);
}

function syntheticPlanAction(
  plan: PlanThisDocument,
  chat: any,
  userObjectId: ObjectId,
  chatTitle: string,
  chatAvatarUrl?: string
): (ChatActionItem & { chatTitle: string; chatAvatarUrl?: string; chatType?: 'direct' | 'group' }) | null {
  const userId = userObjectId.toString();
  const activeParticipants = plan.participants.filter((participant) => !participant.removedAt);
  const isDecisionParticipant = activeParticipants.some((participant) => participant.userId.equals(userObjectId));
  const isCreator = plan.creatorUserId.equals(userObjectId);
  const votes = currentPlanVotes(plan);
  const myVote = votes.find((vote) => vote.userId.equals(userObjectId));
  const open = !['cancelled', 'expired'].includes(plan.state);
  if (!open) return null;

  let label: string | null = null;
  let title = plan.title;
  let assignedTo = { userId, name: activeParticipants.find((participant) => participant.userId.equals(userObjectId))?.displayName };
  let createdBy = { userId: plan.creatorUserId.toString(), name: activeParticipants.find((participant) => participant.userId.equals(plan.creatorUserId))?.displayName };

  if (plan.state === 'finalized' && isDecisionParticipant && plan.suggestedAt) {
    label = 'Upcoming plan';
    title = `Upcoming plan: ${plan.title}`;
  } else if (isDecisionParticipant && !myVote && !['finalized'].includes(plan.state)) {
    label = 'Needs my vote';
    title = `Vote on plan: ${plan.title}`;
  } else if (isCreator && !['finalized'].includes(plan.state)) {
    const waitingVotes = activeParticipants.length - votes.length;
    const waitingAssignments = plan.assignments.filter((assignment) => assignment.status === 'requested').length;
    if (waitingVotes > 0 || waitingAssignments > 0) {
      label = 'Waiting on others';
      title = `Waiting on others: ${plan.title}`;
      assignedTo = createdBy;
    }
  } else if (plan.state === 'finalized' && isDecisionParticipant) {
    label = 'Plan finalized';
    title = `Finalized plan: ${plan.title}`;
  }

  if (!label) return null;
  return {
    id: `plan-this:${plan._id.toString()}:${label.toLowerCase().replace(/\s+/g, '-')}`,
    chatId: plan.chatId.toString(),
    type: plan.state === 'finalized' ? 'event' : 'task',
    title,
    description: label,
    assignedTo,
    createdBy,
    dueAt: plan.suggestedAt?.toISOString(),
    eventStart: plan.suggestedAt?.toISOString(),
    status: 'open',
    visibility: chat.type === 'direct' ? 'personal' : 'chat',
    personalOwnerUserId: chat.type === 'direct' ? userId : undefined,
    sourceMessageIds: plan.proposalMessageId ? [plan.proposalMessageId.toString()] : [],
    metadata: { origin: 'plan_this', planId: plan._id.toString(), planStatus: plan.state, actionState: label },
    permissions: { canUpdateStatus: false, canEdit: false, canDelete: false },
    chatTitle,
    chatAvatarUrl,
    chatType: chat.type,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function normalizeActionStatus(status: ChatActionStatus): ChatActionStatus {
  if (status === 'completed') return 'completed';
  if (status === 'accepted' || status === 'pending') return 'open';
  if (status === 'dismissed') return 'completed';
  return status;
}

function buildActionKey(action: ChatActionItem): string {
  const title = action.title.trim().toLowerCase().replace(/\s+/g, ' ');
  const sourceIds = [...action.sourceMessageIds].sort().join(',');
  const owner = action.assignedTo?.userId || action.assignedTo?.name || 'unassigned';
  return `${action.type}:${title}:${sourceIds || `manual:${owner}`}`;
}

function actionPerson(userId: string, userNames: Map<string, string>): ChatActionPerson {
  return { userId, name: userNames.get(userId) };
}

function parseDueAt(dueAt?: string, dueDate?: string): Date | undefined {
  const raw = dueAt || dueDate;
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isGroupAdminOrOwner(chat: { admins?: ObjectId[]; ownerId?: ObjectId }, userObjectId: ObjectId): boolean {
  const ownerId = chat.ownerId || chat.admins?.[0];
  return Boolean(ownerId?.equals(userObjectId) || chat.admins?.some((adminId) => adminId.equals(userObjectId)));
}

function canManageAction(_action: ChatActionDocument, chat: { admins?: ObjectId[]; ownerId?: ObjectId }, userObjectId: ObjectId): boolean {
  return isGroupAdminOrOwner(chat, userObjectId);
}

function canUpdateActionStatus(action: ChatActionDocument, chat: { admins?: ObjectId[]; ownerId?: ObjectId }, userObjectId: ObjectId): boolean {
  if (actionVisibility(action) === 'personal') {
    return isPersonalActionOwnedBy(action, userObjectId);
  }
  return action.assignedTo?.userId === userObjectId.toString() || canManageAction(action, chat, userObjectId);
}

function canDeleteAction(action: ChatActionDocument, chat: { admins?: ObjectId[]; ownerId?: ObjectId }, userObjectId: ObjectId): boolean {
  if (actionVisibility(action) === 'personal') {
    return isPersonalActionOwnedBy(action, userObjectId);
  }
  const userId = userObjectId.toString();
  return canManageAction(action, chat, userObjectId) || (
    action.createdBy?.userId === userId &&
    action.assignedTo?.userId === userId
  );
}

function isCurrentGroupParticipant(chat: { participants: ObjectId[] }, userId?: string): boolean {
  return Boolean(userId && ObjectId.isValid(userId) && chat.participants.some((participantId) => participantId.equals(new ObjectId(userId))));
}

async function publishActionUpdate(chatId: string, participants: ObjectId[], action: ChatActionItem, actionId?: string) {
  const realtimeAction = { ...action, permissions: undefined };
  const targetUserIds = action.visibility === 'personal' && action.personalOwnerUserId
    ? [action.personalOwnerUserId]
    : participants.map((id) => id.toString());
  try {
    await getPubSub().publish(
      createEvent<ActionUpdatedEvent>(EventType.ACTION_UPDATED, {
        chatId,
        participants: targetUserIds,
        action: realtimeAction,
      })
    );
  } catch (error) {
    logger.error({ error, actionId: actionId || action.id }, 'Failed to publish action updated event');
  }
}

async function getChatForParticipant(chatId: string, userId: string) {
  const chatObjectId = assertObjectId(chatId);
  const userObjectId = assertObjectId(userId);

  if (!chatObjectId || !userObjectId) {
    return { status: 400 as const, chat: null, chatObjectId, userObjectId };
  }

  const chat = await getChatsCollection().findOne({ _id: chatObjectId });
  if (!chat) {
    return { status: 404 as const, chat: null, chatObjectId, userObjectId };
  }

  const isParticipant = chat.participants.some((participantId) => participantId.equals(userObjectId));
  if (!isParticipant) {
    return { status: 403 as const, chat: null, chatObjectId, userObjectId };
  }

  return { status: 200 as const, chat, chatObjectId, userObjectId };
}

function canUseChatActionsForChat(chat: { type: string } | null, res: Response): boolean {
  if (chat?.type === 'group' || chat?.type === 'direct') return true;
  res.status(400).json({
    error: 'Validation Error',
    message: 'Actions are available for chats only',
  });
  return false;
}

function requireActiveActionChat(chat: { type: string; groupKind?: 'standard' | 'temporary'; expiresAt?: Date; endedAt?: Date; deletedAt?: Date } | null, res: Response): boolean {
  if (!canUseChatActionsForChat(chat, res)) return false;
  if (chat?.type === 'group' && isChatExpired(chat)) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'This temporary group has ended',
    });
    return false;
  }
  return true;
}

async function loadUserNames(userIds: string[]): Promise<Map<string, string>> {
  const objectIds = userIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
  if (objectIds.length === 0) return new Map();

  const users = await getDatabase()
    .collection<UserDocument>('users')
    .find({ _id: { $in: objectIds } })
    .project<UserDocument>({ _id: 1, username: 1, email: 1, name: 1 })
    .toArray();

  return new Map(users.map((user) => [user._id.toString(), personName(user)]));
}

function errorForChatStatus(status: 400 | 403 | 404, res: Response) {
  if (status === 400) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }
  if (status === 404) {
    return res.status(404).json({ error: 'Not Found', message: 'Chat not found' });
  }
  return res.status(403).json({
    error: 'Forbidden',
    message: 'You are not a participant in this chat',
  });
}

export const extractChatActions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const bodyResult = ExtractChatActionsDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action extraction payload',
      details: bodyResult.error.errors,
    });
  }

  const { chatId } = req.params;
  const chatResult = await getChatForParticipant(chatId, userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }
  if (!requireActiveActionChat(chatResult.chat, res)) return;

  const messageLimit = bodyResult.data.messageLimit ?? 200;
  const db = getDatabase();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const rawMessages = await messagesCollection
    .find({
      chatId: chatResult.chatObjectId,
      deletedFor: { $ne: chatResult.userObjectId },
      'momentReply.isMomentReply': { $ne: true },
    })
    .sort({ createdAt: -1 })
    .limit(messageLimit)
    .toArray();

  const participantIds = chatResult.chat.participants.map((participantId) => participantId.toString());
  const senderIds = rawMessages.map((message) => message.senderId.toString());
  const userNamesById = await loadUserNames(Array.from(new Set([userId, ...participantIds, ...senderIds])));

  const participants: ActionParticipant[] = participantIds.map((participantId) => ({
    userId: participantId,
    name: userNamesById.get(participantId) ?? null,
  }));

  const contextMessages: ActionInputMessage[] = rawMessages
    .slice()
    .reverse()
    .map((message) => ({
      _id: message._id.toString(),
      senderId: message.senderId.toString(),
      senderName: userNamesById.get(message.senderId.toString()) ?? null,
      body: message.body,
      type: message.type ?? 'text',
      createdAt: message.createdAt.toISOString(),
    }));

  const extractionService = createActionExtractionService();
  const result = await extractionService.extractActions({
    chatId,
    currentUserId: userId,
    currentUserName: userNamesById.get(userId) ?? null,
    chatTitle: chatResult.chat.title ?? null,
    chatDescription: chatResult.chat.description || chatResult.chat.groupContext || null,
    groupContext: chatResult.chat.description || chatResult.chat.groupContext || null,
    participants,
    messages: contextMessages,
  });

  const parsedResult = ChatActionExtractionResultSchema.safeParse(result);
  if (!parsedResult.success) {
    logger.error(
      { issues: parsedResult.error.flatten(), chatId },
      'Generated action extraction failed schema validation'
    );
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Action extraction produced invalid structured output',
    });
  }

  const response: ChatActionExtractionResult = {
    chatId,
    summary: parsedResult.data.summary,
    actions: parsedResult.data.actions.map((action) => ({
      ...action,
      chatId,
      status: 'open',
    })),
    generatedAt: parsedResult.data.generatedAt,
    sourceMessageIds: parsedResult.data.sourceMessageIds,
  };

  logger.info(
    { chatId, userId, actions: response.actions.length, messageLimit },
    'Chat action suggestions extracted'
  );

  return res.status(200).json(response);
});

export const getChatActions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { chatId } = req.params;
  const chatResult = await getChatForParticipant(chatId, userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }
  if (!canUseChatActionsForChat(chatResult.chat, res)) return;

  const actions = await getChatActionsCollection()
    .find({
      chatId: chatResult.chatObjectId!,
      deletedAt: { $exists: false },
      ...(chatResult.chat.type === 'direct'
        ? { visibility: 'personal', personalOwnerUserId: chatResult.userObjectId! }
        : { $or: [{ visibility: { $exists: false } }, { visibility: 'chat' }] }),
    })
    .sort({ createdAt: -1 })
    .toArray();

  const sourcedActions = await materializeItemSources({
    items: actions.map((action) => toActionItem(action, permissionsForVisibleAction(action, chatResult.chat, chatResult.userObjectId!))),
    chatId: chatResult.chatObjectId!,
    userId: chatResult.userObjectId!,
    label: 'Action',
  });

  return res.status(200).json({ actions: sourcedActions });
});

export async function getVisibleMyChatActionItems(userId: string): Promise<MyVisibleActionItem[] | null> {
  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return null;
  }

  const chats = await getChatsCollection()
    .find({ participants: userObjectId, deletedAt: { $exists: false } })
    .project({
      _id: 1,
      type: 1,
      title: 1,
      avatarUrl: 1,
      admins: 1,
      ownerId: 1,
      participants: 1,
      participantProfiles: 1,
      groupKind: 1,
      expiresAt: 1,
      endedAt: 1,
    })
    .toArray();
  const userIdsToLoad = Array.from(new Set(chats.flatMap((chat) => chat.participants?.map((id: ObjectId) => id.toString()) ?? [])));
  const userNamesById = await loadUserNames(userIdsToLoad);
  const directContextForChat = (chat: any) => {
    const otherParticipantId = chat.participants?.find((participantId: ObjectId) => !participantId.equals(userObjectId));
    return otherParticipantId
      ? `Direct chat with ${userNamesById.get(otherParticipantId.toString()) || otherParticipantId.toString()}`
      : 'Direct chat';
  };
  const chatTitleById = new Map(chats.map((chat: any) => [
    chat._id.toString(),
    chat.type === 'direct' ? directContextForChat(chat) : chat.title || 'Group chat',
  ]));
  const chatById = new Map(chats.map((chat) => [chat._id.toString(), chat]));
  const chatIds = chats.map((chat) => chat._id);
  const groupChatIds = chats.filter((chat: any) => chat.type === 'group').map((chat) => chat._id);
  const actions = await getChatActionsCollection()
    .find({
      chatId: { $in: chatIds },
      deletedAt: { $exists: false },
      $or: [
        {
          visibility: 'personal',
          personalOwnerUserId: userObjectId,
        },
        {
          $and: [
            { chatId: { $in: groupChatIds } },
            { $or: [{ visibility: { $exists: false } }, { visibility: 'chat' }] },
            { $or: [{ 'assignedTo.userId': userId }, { 'createdBy.userId': userId }] },
          ],
        },
      ],
    })
    .sort({ lastActivityAt: -1, updatedAt: -1 })
    .toArray();

  const standalonePersonalActions = await getChatActionsCollection()
    .find({
      visibility: 'personal',
      personalOwnerUserId: userObjectId,
      deletedAt: { $exists: false },
      'metadata.origin': 'manual_my_actions',
    })
    .sort({ lastActivityAt: -1, updatedAt: -1 })
    .toArray();

  // Ended/expired temporary groups keep their historical actions visible
  // (consistent with old messages staying visible after a group ends) but
  // the "mine" aggregator must mark them so the frontend doesn't present
  // them as active actionable items — see chatEndedAt on ChatActionItem.
  const chatEndedAtFor = (chat: any): string | undefined => {
    if (!chat || chat.type !== 'group') return undefined;
    if (!isChatExpired(chat)) return undefined;
    return (chat.endedAt instanceof Date ? chat.endedAt : new Date()).toISOString();
  };

  const actionsByChat = new Map<string, ChatActionItem[]>();
  for (const doc of actions) {
    const chat = chatById.get(doc.chatId.toString());
    const item = {
      ...toActionItem(doc, permissionsForVisibleAction(doc, chatById.get(doc.chatId.toString())!, userObjectId)),
      chatTitle: chatTitleById.get(doc.chatId.toString()) || 'Chat',
      chatAvatarUrl: chatById.get(doc.chatId.toString())?.avatarUrl,
      chatType: chatById.get(doc.chatId.toString())?.type,
      chatEndedAt: chatEndedAtFor(chat),
    } as ChatActionItem & { chatTitle: string; chatAvatarUrl?: string };
    const key = doc.chatId.toString();
    actionsByChat.set(key, [...(actionsByChat.get(key) || []), item]);
  }

  const sourcedActions = (
    await Promise.all(
      Array.from(actionsByChat.entries()).map(([chatId, items]) =>
        materializeItemSources({
          items,
          chatId: new ObjectId(chatId),
          userId: userObjectId,
          label: 'Action',
        })
      )
    )
  ).flat();

  const standaloneItems = standalonePersonalActions.map((action) =>
    withMyActionsContext(toActionItem(action, permissionsForPersonalAction(action, userObjectId)))
  );

  const plans = await getPlanThisCollection()
    .find({
      chatId: { $in: chatIds },
      $or: [{ creatorUserId: userObjectId }, { 'participants.userId': userObjectId }],
      state: { $nin: ['cancelled', 'expired'] as any },
    })
    .sort({ updatedAt: -1 })
    .limit(120)
    .toArray();
  const planActions = plans
    .map((plan) => {
      const chat = chatById.get(plan.chatId.toString());
      if (!chat) return null;
      const synthetic = syntheticPlanAction(plan, chat, userObjectId, chatTitleById.get(plan.chatId.toString()) || 'Chat', chat.avatarUrl);
      return synthetic ? { ...synthetic, chatEndedAt: chatEndedAtFor(chat) } : null;
    })
    .filter(Boolean) as Array<ChatActionItem & { chatTitle: string; chatAvatarUrl?: string; chatType?: 'direct' | 'group'; chatEndedAt?: string }>;

  return [...standaloneItems, ...planActions, ...sourcedActions] as MyVisibleActionItem[];
}

let actionsDigestEmailSender = sendActionsDigestEmail;

export function setActionsDigestEmailSenderForTest(sender: typeof sendActionsDigestEmail) {
  actionsDigestEmailSender = sender;
}

export const getMyChatActions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const actions = await getVisibleMyChatActionItems(userId);
  if (!actions) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  return res.status(200).json({ actions });
});

export const getMyActionsDigestPreference = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  const preference = await getOrCreateActionEmailDigestPreference(userObjectId);
  return res.status(200).json({ preference: serializeActionEmailDigestPreference(preference) });
});

export const updateMyActionsDigestPreference = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  const parsed = validateActionEmailDigestPreferencePatch(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: 'Validation Error', message: parsed.message });
  }

  const existing = await getOrCreateActionEmailDigestPreference(userObjectId);
  const now = new Date();
  const update = {
    enabled: parsed.value.enabled ?? existing.enabled,
    hourLocal: parsed.value.hourLocal ?? existing.hourLocal,
    timezone: parsed.value.timezone ?? existing.timezone,
    updatedAt: now,
  };
  const result = await getActionEmailDigestPreferencesCollection().findOneAndUpdate(
    { userId: userObjectId },
    { $set: update, $setOnInsert: { userId: userObjectId, createdAt: existing.createdAt || now } },
    { upsert: true, returnDocument: 'after' }
  );
  const preference = result || { ...existing, ...update };

  return res.status(200).json({ preference: serializeActionEmailDigestPreference(preference) });
});

export const emailMyActionsDigest = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  const user = await getDatabase()
    .collection<UserDocument>('users')
    .findOne({ _id: userObjectId, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } } as any);
  const email = user?.email?.trim();
  if (!email) {
    return res.status(400).json({ error: 'Validation Error', message: 'No email address is available for this account.' });
  }

  const visibleActions = await getVisibleMyChatActionItems(userId);
  if (!visibleActions) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  const remaining = remainingDigestActions(visibleActions as DigestActionItem[]);
  if (remaining.length === 0) {
    return res.status(200).json({
      sent: false,
      count: 0,
      message: 'No open Actions to email.',
    });
  }

  const digest = buildActionsDigestEmail({
    userName: user?.name || user?.username,
    userEmail: email,
    actions: remaining,
  });

  const sent = await actionsDigestEmailSender({
    to: email,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  if (!sent) {
    return res.status(502).json({
      error: 'Bad Gateway',
      message: 'Could not send digest. Please try again.',
    });
  }

  return res.status(200).json({
    sent: true,
    count: digest.count,
    message: 'Actions digest sent to your email.',
  });
});

export const createMyChatAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  const bodyResult = CreateChatActionDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action payload',
      details: bodyResult.error.errors,
    });
  }

  const userNames = await loadUserNames([userId]);
  const now = new Date();
  const actor = actionPerson(userId, userNames);
  const dueAt = parseDueAt(bodyResult.data.dueAt, bodyResult.data.dueDate);
  const actionCandidate: ChatActionItem = {
    chatId: userId,
    type: 'task',
    title: bodyResult.data.title,
    description: bodyResult.data.description,
    assignedTo: {
      userId,
      name: bodyResult.data.ownerName || userNames.get(userId),
    },
    createdBy: actor,
    dueDate: bodyResult.data.dueDate,
    dueAt: dueAt?.toISOString(),
    status: 'open',
    visibility: 'personal',
    personalOwnerUserId: userId,
    sourceMessageIds: [],
    sourceText: bodyResult.data.sourceText,
  };
  const actionKey = buildActionKey(actionCandidate);
  const collection = getChatActionsCollection();
  const existing = await collection.findOne({
    visibility: 'personal',
    personalOwnerUserId: userObjectId,
    actionKey,
    deletedAt: { $exists: false },
    status: { $nin: ['completed', 'dismissed'] as any },
    'metadata.origin': 'manual_my_actions',
  });
  if (existing) {
    return res.status(200).json({
      action: withMyActionsContext(toActionItem(existing, permissionsForPersonalAction(existing, userObjectId))),
      duplicate: true,
    });
  }

  const document: ChatActionDocument = {
    _id: new ObjectId(),
    chatId: userObjectId,
    actionKey,
    type: 'task',
    title: bodyResult.data.title,
    description: bodyResult.data.description,
    assignedTo: actionCandidate.assignedTo,
    createdBy: actor,
    dueDate: bodyResult.data.dueDate,
    dueAt,
    status: 'open',
    visibility: 'personal',
    personalOwnerUserId: userObjectId,
    sourceMessageIds: [],
    sourceText: bodyResult.data.sourceText,
    metadata: { origin: 'manual_my_actions', privacy: 'private_personal_action' },
    activity: [
      {
        id: new ObjectId().toString(),
        type: 'created',
        actor,
        message: 'Created manually in My Actions',
        createdAt: now.toISOString(),
      },
    ],
    updates: [],
    lastActivityAt: now,
    generatedByUserId: userObjectId,
    createdAt: now,
    updatedAt: now,
  };

  await collection.insertOne(document);

  logger.info(
    { feature: 'my_actions', userId, actionId: document._id.toString() },
    'Manual My Action created'
  );

  return res.status(201).json({
    action: withMyActionsContext(toActionItem(document, permissionsForPersonalAction(document, userObjectId))),
  });
});

export const createChatAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { chatId } = req.params;
  const chatResult = await getChatForParticipant(chatId, userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }
  if (!requireActiveActionChat(chatResult.chat, res)) return;

  const bodyResult = CreateChatActionDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action payload',
      details: bodyResult.error.errors,
    });
  }

  const sourceMessageIds = bodyResult.data.sourceMessageIds ?? [];
  if (!sourceMessageIds.every(ObjectId.isValid)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'One or more source message IDs are invalid',
    });
  }

  const sourceObjectIds = sourceMessageIds.map((id) => new ObjectId(id));
  if (sourceObjectIds.length > 0) {
    const sourceCount = await getDatabase().collection<MessageDocument>('messages').countDocuments({
      _id: { $in: sourceObjectIds },
      chatId: chatResult.chatObjectId!,
      deletedFor: { $ne: chatResult.userObjectId! },
    });
    if (sourceCount !== sourceObjectIds.length) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `One or more source messages are not available in this ${chatResult.chat.type}`,
      });
    }
  }

  const isDirectChat = chatResult.chat.type === 'direct';
  const requestedOwnerUserId = bodyResult.data.ownerUserId?.trim() || undefined;
  const ownerUserId = isDirectChat ? userId : requestedOwnerUserId;
  if (isDirectChat && requestedOwnerUserId && requestedOwnerUserId !== userId) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Direct chat Actions can only be created as your private personal Action.',
    });
  }
  if (!isDirectChat && ownerUserId) {
    if (!isCurrentGroupParticipant(chatResult.chat, ownerUserId)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Action owner must be a current group member',
      });
    }
    if (!isGroupAdminOrOwner(chatResult.chat, chatResult.userObjectId!) && ownerUserId !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only a group admin can create an Action for another member.',
      });
    }
  }
  const userNames = await loadUserNames([
    ...(ownerUserId ? [ownerUserId] : []),
    userId,
    ...chatResult.chat.participants.map((participantId) => participantId.toString()),
  ]);
  const now = new Date();
  const actor = actionPerson(userId, userNames);
  const dueAt = parseDueAt(bodyResult.data.dueAt, bodyResult.data.dueDate);
  const assignedTo = ownerUserId
    ? {
        userId: ownerUserId,
        name: bodyResult.data.ownerName || userNames.get(ownerUserId),
      }
    : undefined;
  const actionCandidate: ChatActionItem = {
    chatId,
    type: 'task',
    title: bodyResult.data.title,
    description: bodyResult.data.description,
    assignedTo,
    createdBy: actor,
    dueDate: bodyResult.data.dueDate,
    dueAt: dueAt?.toISOString(),
    status: 'open',
    visibility: isDirectChat ? 'personal' : 'chat',
    personalOwnerUserId: isDirectChat ? userId : undefined,
    sourceMessageIds,
    sourceText: bodyResult.data.sourceText,
  };

  const actionKey = buildActionKey(actionCandidate);
  const collection = getChatActionsCollection();
  const existing = sourceObjectIds.length > 0
    ? await collection.findOne({
        chatId: chatResult.chatObjectId!,
        ...(isDirectChat
          ? {
              visibility: 'personal',
              personalOwnerUserId: chatResult.userObjectId!,
              sourceMessageIds: { $in: sourceObjectIds },
            }
          : {
              actionKey,
              $or: [{ visibility: { $exists: false } }, { visibility: 'chat' }],
            }),
        deletedAt: { $exists: false },
        status: { $nin: ['completed', 'dismissed'] as any },
      })
    : null;
  if (existing) {
    const [action] = await materializeItemSources({
      items: [toActionItem(existing, permissionsForVisibleAction(existing, chatResult.chat, chatResult.userObjectId!))],
      chatId: chatResult.chatObjectId!,
      userId: chatResult.userObjectId!,
      label: 'Action',
    });
    const otherParticipantId = chatResult.chat.type === 'direct'
      ? chatResult.chat.participants.find((participantId) => !participantId.equals(chatResult.userObjectId!))
      : null;
    return res.status(200).json({
      action: {
        ...action,
        chatType: chatResult.chat.type,
        chatTitle: chatResult.chat.type === 'direct'
          ? `Direct chat with ${otherParticipantId ? userNames.get(otherParticipantId.toString()) || otherParticipantId.toString() : 'Direct chat'}`
          : chatResult.chat.title || 'Group chat',
        chatAvatarUrl: chatResult.chat.type === 'group' ? chatResult.chat.avatarUrl : undefined,
      },
      duplicate: true,
    });
  }

  const document: ChatActionDocument = {
    _id: new ObjectId(),
    chatId: chatResult.chatObjectId!,
    actionKey,
    type: 'task',
    title: bodyResult.data.title,
    description: bodyResult.data.description,
    assignedTo,
    createdBy: actionCandidate.createdBy,
    dueDate: bodyResult.data.dueDate,
    dueAt,
    status: 'open',
    visibility: isDirectChat ? 'personal' : 'chat',
    personalOwnerUserId: isDirectChat ? chatResult.userObjectId! : undefined,
    sourceMessageIds: sourceObjectIds,
    sourceText: bodyResult.data.sourceText,
    metadata: {
      ...(sourceObjectIds.length === 0 ? { origin: 'manual' } : { origin: 'ai_source' }),
      ...(isDirectChat ? { privacy: 'private_personal_action' } : {}),
    },
    activity: [
      {
        id: new ObjectId().toString(),
        type: 'created',
        actor,
        message: sourceObjectIds.length > 0 ? 'Created from AI source evidence' : 'Created manually',
        createdAt: now.toISOString(),
      },
    ],
    updates: [],
    lastActivityAt: now,
    generatedByUserId: chatResult.userObjectId!,
    createdAt: now,
    updatedAt: now,
  };

  await collection.insertOne(document);
  const [action] = await materializeItemSources({
    items: [toActionItem(document, permissionsForVisibleAction(document, chatResult.chat, chatResult.userObjectId!))],
    chatId: chatResult.chatObjectId!,
    userId: chatResult.userObjectId!,
    label: 'Action',
  });
  const otherParticipantId = chatResult.chat.type === 'direct'
    ? chatResult.chat.participants.find((participantId) => !participantId.equals(chatResult.userObjectId!))
    : null;
  const actionWithChatContext = {
    ...action,
    chatType: chatResult.chat.type,
    chatTitle: chatResult.chat.type === 'direct'
      ? `Direct chat with ${otherParticipantId ? userNames.get(otherParticipantId.toString()) || otherParticipantId.toString() : 'Direct chat'}`
      : chatResult.chat.title || 'Group chat',
    chatAvatarUrl: chatResult.chat.type === 'group' ? chatResult.chat.avatarUrl : undefined,
  };

  try {
    const realtimeAction = { ...actionWithChatContext, permissions: undefined };
    const targetUserIds = actionWithChatContext.visibility === 'personal' && actionWithChatContext.personalOwnerUserId
      ? [actionWithChatContext.personalOwnerUserId]
      : chatResult.chat.participants.map((id) => id.toString());
    await getPubSub().publish(
      createEvent<ActionCreatedEvent>(EventType.ACTION_CREATED, {
        chatId,
        participants: targetUserIds,
        action: realtimeAction,
      })
    );
  } catch (error) {
    logger.error({ error, chatId, actionId: action.id }, 'Failed to publish action created event');
  }

  return res.status(201).json({ action: actionWithChatContext });
});

export const updateChatAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { actionId } = req.params;
  if (!ObjectId.isValid(actionId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid action ID' });
  }

  const bodyResult = UpdateChatActionDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action update payload',
      details: bodyResult.error.errors,
    });
  }

  const collection = getChatActionsCollection();
  const action = await collection.findOne({ _id: new ObjectId(actionId), deletedAt: { $exists: false } });
  if (!action) {
    return res.status(404).json({ error: 'Not Found', message: 'Action not found' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }
  const standalonePersonal = isStandaloneMyAction(action) && isPersonalActionOwnedBy(action, userObjectId);
  let chatResult: Awaited<ReturnType<typeof getChatForParticipant>> | null = null;

  if (!standalonePersonal) {
    chatResult = await getChatForParticipant(action.chatId.toString(), userId);
    if (chatResult.status !== 200) {
      return errorForChatStatus(chatResult.status, res);
    }
    if (!requireActiveActionChat(chatResult.chat, res)) return;
  }
  if (actionVisibility(action) === 'personal' && !isPersonalActionOwnedBy(action, userObjectId)) {
    return res.status(404).json({ error: 'Not Found', message: 'Action not found' });
  }

  const canChangeStatus = standalonePersonal
    ? true
    : canUpdateActionStatus(action, chatResult!.chat, chatResult!.userObjectId!);
  const canEditDetails = actionVisibility(action) === 'personal'
    ? standalonePersonal
    : canManageAction(action, chatResult!.chat, chatResult!.userObjectId!);
  const detailFields = ['title', 'description', 'ownerUserId', 'ownerName', 'dueDate', 'dueAt'] as const;
  const hasDetailEdit = detailFields.some((field) => Object.prototype.hasOwnProperty.call(bodyResult.data, field));

  if (bodyResult.data.status && !canChangeStatus) {
    return res.status(403).json({
      error: 'Forbidden',
      message: "You don't have permission to update this Action.",
    });
  }

  if (hasDetailEdit && !canEditDetails) {
    return res.status(403).json({
      error: 'Forbidden',
      message: actionVisibility(action) === 'personal'
        ? 'Private personal Actions from chats cannot be reassigned or edited from shared Action controls.'
        : "You don't have permission to edit this Action.",
    });
  }

  const userNames = await loadUserNames([userId, bodyResult.data.ownerUserId || action.assignedTo?.userId || '']);
  const actor = actionPerson(userId, userNames);
  const updatedAt = new Date();
  const setFields: Partial<ChatActionDocument> = {
    updatedAt,
    lastActivityAt: updatedAt,
  };
  const unsetFields: Record<string, ''> = {};
  const activity = [...(action.activity ?? [])];

  if (bodyResult.data.title !== undefined) setFields.title = bodyResult.data.title;
  if (bodyResult.data.description !== undefined) setFields.description = bodyResult.data.description;
  if (bodyResult.data.dueDate !== undefined) setFields.dueDate = bodyResult.data.dueDate;
  if (bodyResult.data.dueAt !== undefined || bodyResult.data.dueDate !== undefined) {
    const dueAt = parseDueAt(bodyResult.data.dueAt, bodyResult.data.dueDate);
    if (dueAt) {
      setFields.dueAt = dueAt;
    } else {
      unsetFields.dueAt = '';
    }
  }
  if (bodyResult.data.ownerUserId !== undefined || bodyResult.data.ownerName !== undefined) {
    const ownerUserId = bodyResult.data.ownerUserId || action.assignedTo?.userId;
    if (standalonePersonal && ownerUserId !== userId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Standalone My Actions must stay assigned to you.',
      });
    }
    if (!standalonePersonal && !isCurrentGroupParticipant(chatResult!.chat, ownerUserId)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Action owner must be a current group member',
      });
    }
    setFields.assignedTo = {
      userId: ownerUserId,
      name: bodyResult.data.ownerName || (ownerUserId ? userNames.get(ownerUserId) : action.assignedTo?.name),
    };
  }

  if (hasDetailEdit) {
    activity.push({
      id: new ObjectId().toString(),
      type: 'edited',
      actor,
      message: 'Edited action details',
      createdAt: updatedAt.toISOString(),
    });
  }

  if (bodyResult.data.status) {
    const previousStatus = normalizeActionStatus(action.status);
    const nextStatus = bodyResult.data.status;
    setFields.status = nextStatus;
    if (nextStatus === 'completed' && previousStatus !== 'completed') {
      setFields.completedAt = updatedAt;
      setFields.completedBy = actor;
      activity.push({
        id: new ObjectId().toString(),
        type: 'completed',
        actor,
        message: 'Completed action',
        createdAt: updatedAt.toISOString(),
      });
    } else if (previousStatus === 'completed' && nextStatus !== 'completed') {
      unsetFields.completedAt = '';
      unsetFields.completedBy = '';
      activity.push({
        id: new ObjectId().toString(),
        type: 'reopened',
        actor,
        message: `Reopened action as ${nextStatus === 'in_progress' ? 'in progress' : 'open'}`,
        createdAt: updatedAt.toISOString(),
      });
    } else if (previousStatus !== nextStatus) {
      activity.push({
        id: new ObjectId().toString(),
        type: 'status_changed',
        actor,
        message: `Moved action to ${nextStatus === 'in_progress' ? 'in progress' : nextStatus}`,
        createdAt: updatedAt.toISOString(),
      });
    }
  }

  setFields.activity = activity;
  const update: { $set: Partial<ChatActionDocument>; $unset?: Record<string, ''> } = { $set: setFields };
  if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
  const updated = await collection.findOneAndUpdate(
    { _id: action._id, deletedAt: { $exists: false } },
    update,
    { returnDocument: 'after' }
  );

  if (standalonePersonal) {
    const updatedAction = withMyActionsContext(
      toActionItem(updated!, permissionsForPersonalAction(updated!, userObjectId))
    );
    return res.status(200).json({ action: updatedAction });
  }

  const [updatedAction] = await materializeItemSources({
    items: [toActionItem(updated!, permissionsForVisibleAction(updated!, chatResult!.chat, chatResult!.userObjectId!))],
    chatId: chatResult!.chatObjectId!,
    userId: chatResult!.userObjectId!,
    label: 'Action',
  });
  await publishActionUpdate(updatedAction.chatId, chatResult!.chat.participants, updatedAction, actionId);

  return res.status(200).json({ action: updatedAction });
});

export const addChatActionUpdate = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { actionId } = req.params;
  if (!ObjectId.isValid(actionId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid action ID' });
  }

  const bodyResult = AddChatActionUpdateDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action update payload',
      details: bodyResult.error.errors,
    });
  }

  const collection = getChatActionsCollection();
  const action = await collection.findOne({ _id: new ObjectId(actionId), deletedAt: { $exists: false } });
  if (!action) {
    return res.status(404).json({ error: 'Not Found', message: 'Action not found' });
  }

  const chatResult = await getChatForParticipant(action.chatId.toString(), userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }
  if (!requireActiveActionChat(chatResult.chat, res)) return;
  if (actionVisibility(action) === 'personal') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Private personal Actions do not support shared updates.',
    });
  }

  const userNames = await loadUserNames([userId]);
  const actor = actionPerson(userId, userNames);
  const now = new Date();
  const updateEntry = {
    id: new ObjectId().toString(),
    body: bodyResult.data.body,
    author: actor,
    createdAt: now.toISOString(),
  };
  const activityEntry = {
    id: new ObjectId().toString(),
    type: 'commented' as const,
    actor,
    message: 'Added an update',
    createdAt: now.toISOString(),
  };

  const updated = await collection.findOneAndUpdate(
    { _id: action._id, deletedAt: { $exists: false } },
    {
      $push: {
        updates: updateEntry,
        activity: activityEntry,
      },
      $set: {
        updatedAt: now,
        lastActivityAt: now,
      },
    } as any,
    { returnDocument: 'after' }
  );

  const [updatedAction] = await materializeItemSources({
    items: [toActionItem(updated!, permissionsForVisibleAction(updated!, chatResult.chat, chatResult.userObjectId!))],
    chatId: chatResult.chatObjectId!,
    userId: chatResult.userObjectId!,
    label: 'Action',
  });
  await publishActionUpdate(updatedAction.chatId, chatResult.chat.participants, updatedAction, actionId);

  return res.status(201).json({ action: updatedAction });
});

export const deleteChatAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { actionId } = req.params;
  if (!ObjectId.isValid(actionId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid action ID' });
  }

  const bodyResult = DeleteChatActionDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action delete payload',
      details: bodyResult.error.errors,
    });
  }

  const collection = getChatActionsCollection();
  const action = await collection.findOne({ _id: new ObjectId(actionId), deletedAt: { $exists: false } });
  if (!action) {
    return res.status(404).json({ error: 'Not Found', message: 'Action not found' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }
  const standalonePersonal = isStandaloneMyAction(action) && isPersonalActionOwnedBy(action, userObjectId);
  let chatResult: Awaited<ReturnType<typeof getChatForParticipant>> | null = null;

  if (!standalonePersonal) {
    chatResult = await getChatForParticipant(action.chatId.toString(), userId);
    if (chatResult.status !== 200) {
      return errorForChatStatus(chatResult.status, res);
    }
    if (!requireActiveActionChat(chatResult.chat, res)) return;
  }
  if (actionVisibility(action) === 'personal' && !isPersonalActionOwnedBy(action, userObjectId)) {
    return res.status(404).json({ error: 'Not Found', message: 'Action not found' });
  }
  if (!standalonePersonal && !canDeleteAction(action, chatResult!.chat, chatResult!.userObjectId!)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: "You don't have permission to delete this Action.",
    });
  }

  const userNames = await loadUserNames([userId]);
  const actor = actionPerson(userId, userNames);
  const now = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: action._id, deletedAt: { $exists: false } },
    {
      $set: {
        deletedAt: now,
        deletedBy: actor,
        updatedAt: now,
        lastActivityAt: now,
        metadata: {
          ...(action.metadata || {}),
          deleteReason: bodyResult.data.reason || 'Deleted from action menu',
        },
      },
      $push: {
        activity: {
          id: new ObjectId().toString(),
          type: 'edited',
          actor,
          message: 'Deleted action',
          createdAt: now.toISOString(),
        },
      },
    } as any,
    { returnDocument: 'after' }
  );

  const deletedAction = toActionItem(
    updated!,
    standalonePersonal
      ? permissionsForPersonalAction(updated!, userObjectId)
      : permissionsForVisibleAction(updated!, chatResult!.chat, chatResult!.userObjectId!)
  );
  if (standalonePersonal) {
    return res.status(200).json({ action: withMyActionsContext(deletedAction) });
  }
  await publishActionUpdate(deletedAction.chatId, chatResult!.chat.participants, deletedAction, actionId);

  return res.status(200).json({ action: deletedAction });
});
