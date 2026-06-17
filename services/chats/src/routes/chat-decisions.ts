import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger } from '@repo/utils';
import {
  DecisionExtractionResultSchema,
  ExtractChatDecisionsDTOSchema,
  UpdateChatDecisionDTOSchema,
  type ChatDecision,
  type DecisionExtractionResult,
} from '@repo/types';
import { getChatsCollection } from '../models/chat';
import {
  getChatDecisionsCollection,
  type ChatDecisionDocument,
} from '../models/chat-decision';
import { getDatabase } from '../db';
import {
  createDecisionExtractionService,
  type DecisionInputMessage,
  type DecisionParticipant,
} from '../intelligence/decision-extraction-service';

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

function toObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function personName(user: UserDocument): string {
  return user.name || user.username || user.email || user._id.toString();
}

function toDecision(doc: ChatDecisionDocument): ChatDecision {
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    title: doc.title,
    description: doc.description,
    status: doc.status,
    decidedBy: doc.decidedBy,
    decidedAt: doc.decidedAt,
    confidence: doc.confidence,
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: doc.sourceText,
    relatedActionIds: doc.relatedActionIds?.map((id) => id.toString()),
    category: doc.category,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function buildDecisionKey(decision: ChatDecision): string {
  const title = decision.title.trim().toLowerCase().replace(/\s+/g, ' ');
  const sourceIds = [...decision.sourceMessageIds].sort().join(',');
  return `${title}:${sourceIds}`;
}

async function getChatForParticipant(chatId: string, userId: string) {
  const chatObjectId = toObjectId(chatId);
  const userObjectId = toObjectId(userId);

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

export const extractChatDecisions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const bodyResult = ExtractChatDecisionsDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid decision extraction payload',
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
  const rawMessages = await db
    .collection<MessageDocument>('messages')
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

  const participants: DecisionParticipant[] = participantIds.map((participantId) => ({
    userId: participantId,
    name: userNamesById.get(participantId) ?? null,
  }));

  const contextMessages: DecisionInputMessage[] = rawMessages
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

  const decisionService = createDecisionExtractionService();
  const result = await decisionService.extractDecisions({
    chatId,
    currentUserId: userId,
    currentUserName: userNamesById.get(userId) ?? null,
    participants,
    messages: contextMessages,
  });

  const parsedResult = DecisionExtractionResultSchema.safeParse(result);
  if (!parsedResult.success) {
    logger.error(
      { issues: parsedResult.error.flatten(), chatId },
      'Generated decision extraction failed schema validation'
    );
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Decision extraction produced invalid structured output',
    });
  }

  const collection = getChatDecisionsCollection();
  const now = new Date();
  const decisions: ChatDecision[] = [];

  for (const decision of parsedResult.data.decisions) {
    const decisionKey = buildDecisionKey(decision);
    const existing = await collection.findOne({ chatId: chatResult.chatObjectId!, decisionKey });
    if (existing) {
      decisions.push(toDecision(existing));
      continue;
    }

    const sourceMessageIds = decision.sourceMessageIds.map((id) => new ObjectId(id));
    const relatedActionIds = decision.relatedActionIds
      ?.filter(ObjectId.isValid)
      .map((id) => new ObjectId(id));
    const document: ChatDecisionDocument = {
      _id: new ObjectId(),
      chatId: chatResult.chatObjectId!,
      decisionKey,
      title: decision.title,
      description: decision.description,
      status: decision.status,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      confidence: decision.confidence,
      sourceMessageIds,
      sourceText: decision.sourceText,
      relatedActionIds,
      category: decision.category,
      metadata: decision.metadata,
      generatedByUserId: chatResult.userObjectId!,
      createdAt: now,
      updatedAt: now,
    };

    await collection.insertOne(document);
    decisions.push(toDecision(document));
  }

  const response: DecisionExtractionResult = {
    chatId,
    summary: parsedResult.data.summary,
    decisions,
    generatedAt: parsedResult.data.generatedAt,
    sourceMessageIds: parsedResult.data.sourceMessageIds,
  };

  logger.info(
    { chatId, userId, decisions: decisions.length, messageLimit },
    'Chat decisions extracted'
  );

  return res.status(200).json(response);
});

export const getChatDecisions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { chatId } = req.params;
  const chatResult = await getChatForParticipant(chatId, userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }

  const decisions = await getChatDecisionsCollection()
    .find({ chatId: chatResult.chatObjectId! })
    .sort({ createdAt: -1 })
    .toArray();

  return res.status(200).json({ decisions: decisions.map(toDecision) });
});

export const updateChatDecision = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { decisionId } = req.params;
  if (!ObjectId.isValid(decisionId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid decision ID' });
  }

  const bodyResult = UpdateChatDecisionDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid decision update payload',
      details: bodyResult.error.errors,
    });
  }

  const update: Record<string, unknown> = {};
  if (bodyResult.data.status !== undefined) update.status = bodyResult.data.status;
  if (bodyResult.data.title !== undefined) update.title = bodyResult.data.title;
  if (bodyResult.data.description !== undefined) update.description = bodyResult.data.description;
  if (Object.keys(update).length === 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'No decision fields provided',
    });
  }

  const collection = getChatDecisionsCollection();
  const decision = await collection.findOne({ _id: new ObjectId(decisionId) });
  if (!decision) {
    return res.status(404).json({ error: 'Not Found', message: 'Decision not found' });
  }

  const chatResult = await getChatForParticipant(decision.chatId.toString(), userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }

  update.updatedAt = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: decision._id },
    { $set: update },
    { returnDocument: 'after' }
  );

  return res.status(200).json({ decision: toDecision(updated!) });
});

export const deleteChatDecision = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { decisionId } = req.params;
  if (!ObjectId.isValid(decisionId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid decision ID' });
  }

  const collection = getChatDecisionsCollection();
  const decision = await collection.findOne({ _id: new ObjectId(decisionId) });
  if (!decision) {
    return res.status(404).json({ error: 'Not Found', message: 'Decision not found' });
  }

  const chatResult = await getChatForParticipant(decision.chatId.toString(), userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }

  await collection.deleteOne({ _id: decision._id });
  return res.status(204).send();
});
