import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import {
  ExtractWaitingOnDTOSchema,
  UpdateWaitingOnDTOSchema,
  WaitingOnExtractionResultSchema,
  type WaitingOnExtractionResult,
  type WaitingOnItem,
  type WaitingOnPerson,
} from '@repo/types';
import { asyncHandler, logger } from '@repo/utils';
import { getDatabase } from '../db';
import { getChatsCollection } from '../models/chat';
import { getWaitingOnCollection, type WaitingOnDocument } from '../models/chat-waiting-on';
import {
  createWaitingOnExtractionService,
  type WaitingOnInputMessage,
  type WaitingOnParticipant,
} from '../intelligence/waiting-on-extraction-service';
import { materializeItemSources } from '../intelligence-source-materializer';

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

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function optionalPerson(person: WaitingOnPerson | null | undefined): WaitingOnPerson | undefined {
  if (!person) return undefined;
  const userId = optional(person.userId);
  const name = optional(person.name);
  return userId || name ? { userId, name } : undefined;
}

function toWaitingOnItem(doc: WaitingOnDocument): WaitingOnItem {
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    direction: doc.direction,
    title: doc.title,
    description: optional(doc.description),
    person: optionalPerson(doc.person),
    requester: optionalPerson(doc.requester),
    owner: optionalPerson(doc.owner),
    status: doc.status,
    priority: optional(doc.priority),
    dueDate: optional(doc.dueDate),
    confidence: optional(doc.confidence),
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: optional(doc.sourceText),
    relatedActionIds: doc.relatedActionIds?.map((id) => id.toString()),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function buildWaitingOnKey(item: WaitingOnItem): string {
  const title = item.title.trim().toLowerCase().replace(/\s+/g, ' ');
  const sourceIds = [...item.sourceMessageIds].sort().join(',');
  return `${item.direction}:${title}:${sourceIds}`;
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

export const extractWaitingOnItems = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const bodyResult = ExtractWaitingOnDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid waiting-on extraction payload',
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
      'momentReply.isMomentReply': { $ne: true },
    })
    .sort({ createdAt: -1 })
    .limit(messageLimit)
    .toArray();

  const participantIds = chatResult.chat.participants.map((participantId) => participantId.toString());
  const senderIds = rawMessages.map((message) => message.senderId.toString());
  const userNamesById = await loadUserNames(Array.from(new Set([userId, ...participantIds, ...senderIds])));

  const participants: WaitingOnParticipant[] = participantIds.map((participantId) => ({
    userId: participantId,
    name: userNamesById.get(participantId) ?? null,
  }));

  const contextMessages: WaitingOnInputMessage[] = rawMessages
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

  const extractionService = createWaitingOnExtractionService();
  const result = await extractionService.extractWaitingOn({
    chatId,
    currentUserId: userId,
    currentUserName: userNamesById.get(userId) ?? null,
    participants,
    messages: contextMessages,
  });

  const parsedResult = WaitingOnExtractionResultSchema.safeParse(result);
  if (!parsedResult.success) {
    logger.error(
      { issues: parsedResult.error.flatten(), chatId },
      'Generated waiting-on extraction failed schema validation'
    );
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Waiting-on extraction produced invalid structured output',
    });
  }

  const collection = getWaitingOnCollection();
  const now = new Date();
  const waitingOn: WaitingOnItem[] = [];

  for (const item of parsedResult.data.waitingOn) {
    const waitingOnKey = buildWaitingOnKey(item);
    const existing = await collection.findOne({ chatId: chatResult.chatObjectId!, waitingOnKey });
    if (existing) {
      waitingOn.push(toWaitingOnItem(existing));
      continue;
    }

    const sourceMessageIds = item.sourceMessageIds.map((id) => new ObjectId(id));
    const relatedActionIds = item.relatedActionIds
      ?.filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const document: WaitingOnDocument = {
      _id: new ObjectId(),
      chatId: chatResult.chatObjectId!,
      waitingOnKey,
      direction: item.direction,
      title: item.title,
      description: item.description,
      person: item.person,
      requester: item.requester,
      owner: item.owner,
      status: item.status,
      priority: item.priority,
      dueDate: item.dueDate,
      confidence: item.confidence,
      sourceMessageIds,
      sourceText: item.sourceText,
      relatedActionIds,
      generatedByUserId: chatResult.userObjectId!,
      createdAt: now,
      updatedAt: now,
    };

    await collection.insertOne(document);
    waitingOn.push(toWaitingOnItem(document));
  }

  const sourcedWaitingOn = await materializeItemSources({
    items: waitingOn,
    chatId: chatResult.chatObjectId!,
    userId: chatResult.userObjectId!,
    label: 'Waiting On',
  });

  const response: WaitingOnExtractionResult = {
    chatId,
    summary: parsedResult.data.summary,
    waitingOn: sourcedWaitingOn,
    generatedAt: parsedResult.data.generatedAt,
    sourceMessageIds: parsedResult.data.sourceMessageIds,
  };

  logger.info(
    { chatId, userId, waitingOn: waitingOn.length, messageLimit },
    'Waiting-on items extracted'
  );

  return res.status(200).json(response);
});

export const getWaitingOnItems = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { chatId } = req.params;
  const chatResult = await getChatForParticipant(chatId, userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }

  const waitingOn = await getWaitingOnCollection()
    .find({ chatId: chatResult.chatObjectId! })
    .sort({ createdAt: -1 })
    .toArray();

  const sourcedWaitingOn = await materializeItemSources({
    items: waitingOn.map(toWaitingOnItem),
    chatId: chatResult.chatObjectId!,
    userId: chatResult.userObjectId!,
    label: 'Waiting On',
  });

  return res.status(200).json({ waitingOn: sourcedWaitingOn });
});

export const updateWaitingOnItem = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { itemId } = req.params;
  if (!ObjectId.isValid(itemId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid waiting-on item ID' });
  }

  const bodyResult = UpdateWaitingOnDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid waiting-on update payload',
      details: bodyResult.error.errors,
    });
  }

  const update: Record<string, unknown> = {};
  if (bodyResult.data.status !== undefined) update.status = bodyResult.data.status;
  if (bodyResult.data.title !== undefined) update.title = bodyResult.data.title;
  if (bodyResult.data.description !== undefined) update.description = bodyResult.data.description;
  if (bodyResult.data.priority !== undefined) update.priority = bodyResult.data.priority;
  if (bodyResult.data.dueDate !== undefined) update.dueDate = bodyResult.data.dueDate;
  if (Object.keys(update).length === 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'No waiting-on fields provided',
    });
  }

  const collection = getWaitingOnCollection();
  const item = await collection.findOne({ _id: new ObjectId(itemId) });
  if (!item) {
    return res.status(404).json({ error: 'Not Found', message: 'Waiting-on item not found' });
  }

  const chatResult = await getChatForParticipant(item.chatId.toString(), userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }

  update.updatedAt = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: item._id },
    { $set: update },
    { returnDocument: 'after' }
  );

  const [itemWithSources] = await materializeItemSources({
    items: [toWaitingOnItem(updated!)],
    chatId: chatResult.chatObjectId!,
    userId: chatResult.userObjectId!,
    label: 'Waiting On',
  });

  return res.status(200).json({ item: itemWithSources });
});

export const deleteWaitingOnItem = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { itemId } = req.params;
  if (!ObjectId.isValid(itemId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid waiting-on item ID' });
  }

  const collection = getWaitingOnCollection();
  const item = await collection.findOne({ _id: new ObjectId(itemId) });
  if (!item) {
    return res.status(404).json({ error: 'Not Found', message: 'Waiting-on item not found' });
  }

  const chatResult = await getChatForParticipant(item.chatId.toString(), userId);
  if (chatResult.status !== 200) {
    return errorForChatStatus(chatResult.status, res);
  }

  await collection.deleteOne({ _id: item._id });
  return res.status(204).send();
});
