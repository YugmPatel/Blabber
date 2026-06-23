import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import {
  CreateChatActionDTOSchema,
  EventType,
  ChatActionExtractionResultSchema,
  ExtractChatActionsDTOSchema,
  UpdateChatActionDTOSchema,
  type ActionCreatedEvent,
  type ActionUpdatedEvent,
  type ChatActionExtractionResult,
  type ChatActionItem,
  type ChatActionStatus,
} from '@repo/types';
import { getChatsCollection } from '../models/chat';
import {
  getChatActionsCollection,
  type ChatActionDocument,
} from '../models/chat-action';
import { getDatabase } from '../db';
import {
  createActionExtractionService,
  type ActionInputMessage,
  type ActionParticipant,
} from '../intelligence/action-extraction-service';
import { getPubSub } from '../pubsub';
import { isChatExpired } from '../serialize-chat';

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

function assertObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function personName(user: UserDocument): string {
  return user.name || user.username || user.email || user._id.toString();
}

function toActionItem(doc: ChatActionDocument): ChatActionItem {
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
    eventStart: doc.eventStart,
    eventEnd: doc.eventEnd,
    status,
    priority: doc.priority,
    confidence: doc.confidence,
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: doc.sourceText,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
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
  return `${action.type}:${title}:${sourceIds}`;
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

function requireGroupChat(chat: { type: string } | null, res: Response): boolean {
  if (chat?.type === 'group') return true;
  res.status(400).json({
    error: 'Validation Error',
    message: 'Actions are available for group chats only',
  });
  return false;
}

function requireActiveGroup(chat: { type: string; groupKind?: 'standard' | 'temporary'; expiresAt?: Date; endedAt?: Date; deletedAt?: Date } | null, res: Response): boolean {
  if (!requireGroupChat(chat, res)) return false;
  if (chat && isChatExpired(chat)) {
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
  if (!requireActiveGroup(chatResult.chat, res)) return;

  const messageLimit = bodyResult.data.messageLimit ?? 200;
  const db = getDatabase();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const rawMessages = await messagesCollection
    .find({
      chatId: chatResult.chatObjectId,
      deletedFor: { $ne: chatResult.userObjectId },
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
    chatDescription: chatResult.chat.description ?? null,
    groupContext: chatResult.chat.groupContext ?? null,
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
  if (!requireGroupChat(chatResult.chat, res)) return;

  const actions = await getChatActionsCollection()
    .find({ chatId: chatResult.chatObjectId! })
    .sort({ createdAt: -1 })
    .toArray();

  return res.status(200).json({ actions: actions.map(toActionItem) });
});

export const getMyChatActions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = assertObjectId(userId);
  if (!userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid user ID' });
  }

  const chats = await getChatsCollection()
    .find({ participants: userObjectId, type: 'group', deletedAt: { $exists: false } })
    .project({ _id: 1, title: 1 })
    .toArray();
  const chatTitleById = new Map(chats.map((chat) => [chat._id.toString(), chat.title || 'Group chat']));
  const actions = await getChatActionsCollection()
    .find({
      chatId: { $in: chats.map((chat) => chat._id) },
      'assignedTo.userId': userId,
    })
    .sort({ updatedAt: -1 })
    .toArray();

  return res.status(200).json({
    actions: actions.map((doc) => ({
      ...toActionItem(doc),
      chatTitle: chatTitleById.get(doc.chatId.toString()) || 'Group chat',
    })),
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
  if (!requireActiveGroup(chatResult.chat, res)) return;

  const bodyResult = CreateChatActionDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid action payload',
      details: bodyResult.error.errors,
    });
  }

  if (!bodyResult.data.sourceMessageIds.every(ObjectId.isValid)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'One or more source message IDs are invalid',
    });
  }

  const sourceObjectIds = bodyResult.data.sourceMessageIds.map((id) => new ObjectId(id));
  const sourceCount = await getDatabase().collection<MessageDocument>('messages').countDocuments({
    _id: { $in: sourceObjectIds },
    chatId: chatResult.chatObjectId!,
    deletedFor: { $ne: chatResult.userObjectId! },
  });
  if (sourceCount !== sourceObjectIds.length) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'One or more source messages are not available in this group',
    });
  }

  const ownerUserId = bodyResult.data.ownerUserId || userId;
  const userNames = await loadUserNames([ownerUserId, userId]);
  const actionCandidate: ChatActionItem = {
    chatId,
    type: 'task',
    title: bodyResult.data.title,
    description: bodyResult.data.description,
    assignedTo: {
      userId: ownerUserId,
      name: bodyResult.data.ownerName || userNames.get(ownerUserId),
    },
    createdBy: {
      userId,
      name: userNames.get(userId),
    },
    dueDate: bodyResult.data.dueDate,
    status: 'open',
    sourceMessageIds: bodyResult.data.sourceMessageIds,
    sourceText: bodyResult.data.sourceText,
  };

  const actionKey = buildActionKey(actionCandidate);
  const collection = getChatActionsCollection();
  const existing = await collection.findOne({ chatId: chatResult.chatObjectId!, actionKey });
  if (existing) {
    return res.status(200).json({ action: toActionItem(existing), duplicate: true });
  }

  const now = new Date();
  const document: ChatActionDocument = {
    _id: new ObjectId(),
    chatId: chatResult.chatObjectId!,
    actionKey,
    type: 'task',
    title: bodyResult.data.title,
    description: bodyResult.data.description,
    assignedTo: actionCandidate.assignedTo,
    createdBy: actionCandidate.createdBy,
    dueDate: bodyResult.data.dueDate,
    status: 'open',
    sourceMessageIds: sourceObjectIds,
    sourceText: bodyResult.data.sourceText,
    generatedByUserId: chatResult.userObjectId!,
    createdAt: now,
    updatedAt: now,
  };

  await collection.insertOne(document);
  const action = toActionItem(document);

  try {
    await getPubSub().publish(
      createEvent<ActionCreatedEvent>(EventType.ACTION_CREATED, {
        chatId,
        participants: chatResult.chat.participants.map((id) => id.toString()),
        action,
      })
    );
  } catch (error) {
    logger.error({ error, chatId, actionId: action.id }, 'Failed to publish action created event');
  }

  return res.status(201).json({ action });
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
  const action = await collection.findOne({ _id: new ObjectId(actionId) });
  if (!action) {
    return res.status(404).json({ error: 'Not Found', message: 'Action not found' });
  }

  const chatResult = await getChatForParticipant(action.chatId.toString(), userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }
  if (!requireActiveGroup(chatResult.chat, res)) return;

  const assignedUserId = action.assignedTo?.userId;
  const isOwner = assignedUserId ? assignedUserId === userId : true;
  if (!isOwner) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only the assigned owner can update this action status',
    });
  }

  const updatedAt = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: action._id },
    { $set: { status: bodyResult.data.status, updatedAt } },
    { returnDocument: 'after' }
  );

  const updatedAction = toActionItem(updated!);
  try {
    await getPubSub().publish(
      createEvent<ActionUpdatedEvent>(EventType.ACTION_UPDATED, {
        chatId: updatedAction.chatId,
        participants: chatResult.chat.participants.map((id) => id.toString()),
        action: updatedAction,
      })
    );
  } catch (error) {
    logger.error({ error, actionId }, 'Failed to publish action updated event');
  }

  return res.status(200).json({ action: updatedAction });
});
