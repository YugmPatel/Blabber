import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger } from '@repo/utils';
import {
  ChatActionExtractionResultSchema,
  ExtractChatActionsDTOSchema,
  UpdateChatActionDTOSchema,
  type ChatActionExtractionResult,
  type ChatActionItem,
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
    status: doc.status,
    priority: doc.priority,
    confidence: doc.confidence,
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: doc.sourceText,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
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

  const collection = getChatActionsCollection();
  const now = new Date();
  const actions: ChatActionItem[] = [];

  for (const action of parsedResult.data.actions) {
    const actionKey = buildActionKey(action);
    const existing = await collection.findOne({ chatId: chatResult.chatObjectId!, actionKey });
    if (existing) {
      actions.push(toActionItem(existing));
      continue;
    }

    const sourceMessageIds = action.sourceMessageIds.map((id) => new ObjectId(id));
    const document: ChatActionDocument = {
      _id: new ObjectId(),
      chatId: chatResult.chatObjectId!,
      actionKey,
      type: action.type,
      title: action.title,
      description: action.description,
      assignedTo: action.assignedTo,
      createdBy: action.createdBy,
      dueDate: action.dueDate,
      eventStart: action.eventStart,
      eventEnd: action.eventEnd,
      status: action.status,
      priority: action.priority,
      confidence: action.confidence,
      sourceMessageIds,
      sourceText: action.sourceText,
      metadata: action.metadata,
      generatedByUserId: chatResult.userObjectId!,
      createdAt: now,
      updatedAt: now,
    };

    await collection.insertOne(document);
    actions.push(toActionItem(document));
  }

  const response: ChatActionExtractionResult = {
    chatId,
    summary: parsedResult.data.summary,
    actions,
    generatedAt: parsedResult.data.generatedAt,
    sourceMessageIds: parsedResult.data.sourceMessageIds,
  };

  logger.info(
    { chatId, userId, actions: actions.length, messageLimit },
    'Chat actions extracted'
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

  const actions = await getChatActionsCollection()
    .find({ chatId: chatResult.chatObjectId! })
    .sort({ createdAt: -1 })
    .toArray();

  return res.status(200).json({ actions: actions.map(toActionItem) });
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

  const updatedAt = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: action._id },
    { $set: { status: bodyResult.data.status, updatedAt } },
    { returnDocument: 'after' }
  );

  return res.status(200).json({ action: toActionItem(updated!) });
});
