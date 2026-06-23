import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import {
  GroupBrainAnswerSchema,
  GroupBrainSchema,
  type ChatActionItem,
  type ChatDecision,
  type GroupBrain,
  type GroupBrainDeadline,
  type GroupBrainFile,
  type GroupBrainLink,
  type GroupBrainParticipant,
  type GroupBrainPlan,
  type GroupBrainQuestion,
  type WaitingOnItem,
} from '@repo/types';
import { asyncHandler, logger } from '@repo/utils';
import { getDatabase } from '../db';
import { isChatExpired } from '../serialize-chat';
import { getChatsCollection } from '../models/chat';
import { getChatActionsCollection, type ChatActionDocument } from '../models/chat-action';
import { getChatDecisionsCollection, type ChatDecisionDocument } from '../models/chat-decision';
import { getChatSummariesCollection, type ChatSummaryDocument } from '../models/chat-summary';
import { getWaitingOnCollection, type WaitingOnDocument } from '../models/chat-waiting-on';

interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  type?: string;
  body: string;
  media?: {
    type?: string;
    url?: string;
    mediaId?: ObjectId;
    fileName?: string;
    mimeType?: string;
  };
  deletedFor?: ObjectId[];
  createdAt: Date;
}

interface UserDocument {
  _id: ObjectId;
  username?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>)"']+/gi;

function toObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function personName(user: UserDocument): string {
  return user.name || user.username || user.email || user._id.toString();
}

function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/g, '');
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function optionalPerson<T extends { userId?: string | null; name?: string | null }>(
  person: T | null | undefined
) {
  if (!person) return undefined;
  const userId = optional(person.userId);
  const name = optional(person.name);
  return userId || name ? { userId, name } : undefined;
}

function isPerson(person: ReturnType<typeof optionalPerson>): person is NonNullable<ReturnType<typeof optionalPerson>> {
  return Boolean(person);
}

function toActionItem(doc: ChatActionDocument): ChatActionItem {
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    type: doc.type,
    title: doc.title,
    description: optional(doc.description),
    assignedTo: optionalPerson(doc.assignedTo),
    createdBy: optionalPerson(doc.createdBy),
    dueDate: optional(doc.dueDate),
    eventStart: optional(doc.eventStart),
    eventEnd: optional(doc.eventEnd),
    status: doc.status,
    priority: optional(doc.priority),
    confidence: optional(doc.confidence),
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: optional(doc.sourceText),
    metadata: optional(doc.metadata),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toDecision(doc: ChatDecisionDocument): ChatDecision {
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    title: doc.title,
    description: optional(doc.description),
    status: doc.status,
    decidedBy: optional(doc.decidedBy?.map(optionalPerson).filter(isPerson)),
    decidedAt: optional(doc.decidedAt),
    confidence: optional(doc.confidence),
    sourceMessageIds: doc.sourceMessageIds.map((id) => id.toString()),
    sourceText: optional(doc.sourceText),
    relatedActionIds: doc.relatedActionIds?.map((id) => id.toString()),
    category: optional(doc.category),
    metadata: optional(doc.metadata),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
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

function linksFromMessages(messages: MessageDocument[]): GroupBrainLink[] {
  const links: GroupBrainLink[] = [];

  for (const message of messages) {
    for (const match of message.body.matchAll(URL_PATTERN)) {
      const url = cleanUrl(match[0]);
      try {
        new URL(url);
      } catch {
        continue;
      }

      links.push({
        url,
        sourceMessageId: message._id.toString(),
        addedAt: message.createdAt.toISOString(),
      });
    }
  }

  return links;
}

function dedupeLinks(links: GroupBrainLink[]): GroupBrainLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = link.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filesFromMessages(messages: MessageDocument[]): GroupBrainFile[] {
  return messages
    .filter((message) => message.media?.url || message.media?.mediaId)
    .map((message) => ({
      id: message.media?.mediaId?.toString(),
      name: message.media?.fileName,
      url: message.media?.url,
      type: message.media?.mimeType || message.media?.type || message.type,
      sourceMessageId: message._id.toString(),
      addedAt: message.createdAt.toISOString(),
    }));
}

function questionsFromSummary(latestSummary: ChatSummaryDocument | null): GroupBrainQuestion[] {
  return (latestSummary?.summary.questionsForMe || []).map((question) => ({
    text: question.question,
    sourceMessageId: question.sourceMessageId,
    status: 'open' as const,
  }));
}

function plansFrom(actions: ChatActionItem[], decisions: ChatDecision[]): GroupBrainPlan[] {
  const actionPlans = actions
    .filter((action) => action.type === 'event' || action.eventStart || action.eventEnd)
    .map((action) => ({
      title: action.title,
      description: action.description,
      date: action.eventStart || action.dueDate || action.eventEnd,
      sourceMessageIds: action.sourceMessageIds,
    }));

  const decisionPlans = decisions
    .filter((decision) => decision.category === 'planning' || decision.category === 'logistics')
    .map((decision) => ({
      title: decision.title,
      description: decision.description,
      date: decision.decidedAt,
      sourceMessageIds: decision.sourceMessageIds,
    }));

  return [...actionPlans, ...decisionPlans].slice(0, 20);
}

function deadlinesFrom(actions: ChatActionItem[]): GroupBrainDeadline[] {
  return actions
    .filter((action) => action.dueDate || action.eventStart || action.eventEnd)
    .map((action) => ({
      title: action.title,
      dueDate: action.dueDate || action.eventStart || action.eventEnd,
      relatedActionId: action.id,
      sourceMessageIds: action.sourceMessageIds,
    }));
}

async function loadParticipants(participantIds: ObjectId[]): Promise<GroupBrainParticipant[]> {
  if (participantIds.length === 0) return [];

  const users = await getDatabase()
    .collection<UserDocument>('users')
    .find({ _id: { $in: participantIds } })
    .project<UserDocument>({ _id: 1, username: 1, email: 1, name: 1, avatarUrl: 1 })
    .toArray();

  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  return participantIds.map((participantId) => {
    const user = byId.get(participantId.toString());
    return {
      userId: participantId.toString(),
      name: user ? personName(user) : undefined,
      username: user?.username,
      avatarUrl: user?.avatarUrl,
    };
  });
}

export const getGroupBrain = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { chatId } = req.params;
  const chatObjectId = toObjectId(chatId);
  const userObjectId = toObjectId(userId);
  if (!chatObjectId || !userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }

  const chat = await getChatsCollection().findOne({ _id: chatObjectId });
  if (!chat) {
    return res.status(404).json({ error: 'Not Found', message: 'Chat not found' });
  }
  if (chat.type !== 'group') {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Group Brain is available for group chats only',
    });
  }
  if (isChatExpired(chat)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'This temporary group has ended',
    });
  }

  const isParticipant = chat.participants.some((participantId) => participantId.equals(userObjectId));
  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }

  const [latestSummary, actionDocs, decisionDocs, waitingOnDocs, messages, participants] = await Promise.all([
    getChatSummariesCollection().findOne({ chatId: chatObjectId }, { sort: { createdAt: -1 } }),
    getChatActionsCollection().find({ chatId: chatObjectId }).sort({ createdAt: -1 }).toArray(),
    getChatDecisionsCollection().find({ chatId: chatObjectId }).sort({ createdAt: -1 }).toArray(),
    getWaitingOnCollection().find({ chatId: chatObjectId }).sort({ createdAt: -1 }).toArray(),
    getDatabase()
      .collection<MessageDocument>('messages')
      .find({ chatId: chatObjectId, deletedFor: { $ne: userObjectId } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray(),
    loadParticipants(chat.participants),
  ]);

  const actions = actionDocs.map(toActionItem);
  const decisions = decisionDocs.map(toDecision);
  const waitingOn = waitingOnDocs.map(toWaitingOnItem);
  const summaryText = latestSummary?.summary.summary || chat.groupContext;
  const summaryLinks: GroupBrainLink[] = (latestSummary?.summary.importantLinks || []).map((link) => ({
    title: link.label ?? undefined,
    url: link.url,
    sourceMessageId: link.sourceMessageId,
    addedAt: latestSummary?.summary.generatedAt,
  }));
  const importantLinks = dedupeLinks([...summaryLinks, ...linksFromMessages(messages)]);
  const importantFiles = filesFromMessages(messages);
  const openQuestions = questionsFromSummary(latestSummary);
  const plans = plansFrom(actions, decisions);
  const deadlines = deadlinesFrom(actions);

  const brain: GroupBrain = {
    chatId,
    overview: summaryText,
    summary: latestSummary
      ? {
          id: latestSummary._id.toString(),
          text: summaryText,
          generatedAt: latestSummary.summary.generatedAt,
        }
      : undefined,
    decisions,
    actions,
    waitingOn,
    importantLinks,
    importantFiles,
    openQuestions,
    plans,
    deadlines,
    participants,
    stats: {
      pendingActions: actions.filter((action) => action.status === 'pending' || action.status === 'accepted').length,
      finalDecisions: decisions.filter((decision) => decision.status === 'final').length,
      openQuestions: openQuestions.length,
      openLoops: waitingOn.filter((item) => item.status === 'open').length,
      links: importantLinks.length,
      files: importantFiles.length,
    },
    sourceSummaryId: latestSummary?._id.toString(),
    sourceActionIds: actions.map((action) => action.id).filter(Boolean) as string[],
    sourceDecisionIds: decisions.map((decision) => decision.id).filter(Boolean) as string[],
    sourceWaitingOnIds: waitingOn.map((item) => item.id).filter(Boolean) as string[],
    lastUpdatedAt: new Date().toISOString(),
  };

  const parsedBrain = GroupBrainSchema.safeParse(brain);
  if (!parsedBrain.success) {
    logger.error(
      { issues: parsedBrain.error.flatten(), chatId },
      'Group Brain aggregation failed schema validation'
    );
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Group Brain aggregation produced invalid output',
    });
  }

  return res.status(200).json({ brain: parsedBrain.data });
});

function scoreMessageForQuestion(message: MessageDocument, terms: string[]): number {
  const text = message.body.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

export const askGroupBrain = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { chatId } = req.params;
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    return res.status(400).json({ error: 'Validation Error', message: 'Question is required' });
  }

  const chatObjectId = toObjectId(chatId);
  const userObjectId = toObjectId(userId);
  if (!chatObjectId || !userObjectId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }

  const chat = await getChatsCollection().findOne({ _id: chatObjectId });
  if (!chat) {
    return res.status(404).json({ error: 'Not Found', message: 'Chat not found' });
  }
  if (chat.type !== 'group') {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Group Brain is available for group chats only',
    });
  }
  if (isChatExpired(chat)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'This temporary group has ended',
    });
  }

  const isParticipant = chat.participants.some((participantId) => participantId.equals(userObjectId));
  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }

  const terms: string[] = Array.from(
    new Set<string>(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((term: string) => term.length > 2)
    )
  );

  const messages = await getDatabase()
    .collection<MessageDocument>('messages')
    .find({ chatId: chatObjectId, deletedFor: { $ne: userObjectId } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  const matches = messages
    .map((message) => ({ message, score: scoreMessageForQuestion(message, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.message.createdAt.getTime() - a.message.createdAt.getTime())
    .slice(0, 3);

  const answer = matches.length
    ? `Group history points to: ${matches.map((entry) => entry.message.body).join(' ')}`
    : 'The group history does not clearly establish an answer to that question.';

  const response = {
    answer,
    confidence: matches.length ? 'grounded' as const : 'uncertain' as const,
    sourceMessageIds: matches.map((entry) => entry.message._id.toString()),
    sourceDates: matches.map((entry) => entry.message.createdAt.toISOString()),
  };

  const parsed = GroupBrainAnswerSchema.safeParse(response);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.flatten(), chatId }, 'Group Brain answer failed schema validation');
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Group Brain answer produced invalid output',
    });
  }

  return res.status(200).json(parsed.data);
});
