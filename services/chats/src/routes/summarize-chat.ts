import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger } from '@repo/utils';
import { ChatIntelligenceSummarySchema, SummarizeChatDTOSchema } from '@repo/types';
import { getChatsCollection } from '../models/chat';
import { getChatSummariesCollection } from '../models/chat-summary';
import { isChatExpired } from '../serialize-chat';
import { getDatabase } from '../db';
import {
  createAISummaryService,
  type SummaryInputMessage,
} from '../intelligence/ai-summary-service';
import { materializeSummarySources } from '../intelligence-source-materializer';
import { personalizeSummary } from '../summary-personalization';

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

function displayName(user: UserDocument): string {
  return user.name || user.username || user._id.toString();
}

function normalizeName(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, ' ');
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveSummaryDueDate(value: string | null | undefined, sourceCreatedAt?: string): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const base = sourceCreatedAt ? new Date(sourceCreatedAt) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const lower = raw.toLowerCase();
  const next = new Date(base);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (lower === 'today' || lower.includes('end of day') || lower === 'eod') return dateInputValue(base);
  if (lower === 'tomorrow') {
    next.setDate(base.getDate() + 1);
    return dateInputValue(next);
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekdayIndex = weekdays.findIndex((day) => lower.includes(day));
  if (weekdayIndex >= 0) {
    const delta = (weekdayIndex - base.getDay() + 7) % 7;
    next.setDate(base.getDate() + delta);
    return dateInputValue(next);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && /\b(\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(raw)) {
    return dateInputValue(parsed);
  }

  return null;
}

function resolveTaskOwner({
  assignedTo,
  assignedToUserId,
  sourceMessageId,
  participantById,
  participantByName,
  messageById,
}: {
  assignedTo?: string | null;
  assignedToUserId?: string | null;
  sourceMessageId: string;
  participantById: Map<string, UserDocument>;
  participantByName: Map<string, UserDocument>;
  messageById: Map<string, SummaryInputMessage>;
}) {
  if (assignedToUserId && participantById.has(assignedToUserId)) {
    const user = participantById.get(assignedToUserId)!;
    return { assignedTo: displayName(user), assignedToUserId: user._id.toString() };
  }

  const normalized = normalizeName(assignedTo);
  const sourceMessage = messageById.get(sourceMessageId);
  if (sourceMessage && ['i', 'me', 'myself'].includes(normalized)) {
    const user = participantById.get(sourceMessage.senderId);
    return user ? { assignedTo: displayName(user), assignedToUserId: user._id.toString() } : { assignedTo: null, assignedToUserId: null };
  }

  const byName = participantByName.get(normalized);
  if (byName) return { assignedTo: displayName(byName), assignedToUserId: byName._id.toString() };

  return { assignedTo: assignedTo || null, assignedToUserId: null };
}

export const summarizeChat = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  const { chatId } = req.params;

  if (!ObjectId.isValid(chatId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid chat ID',
    });
  }

  const bodyResult = SummarizeChatDTOSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid summarize payload',
      details: bodyResult.error.errors,
    });
  }

  const messageLimit = bodyResult.data.messageLimit ?? 200;
  const chatObjectId = new ObjectId(chatId);
  const userObjectId = new ObjectId(userId);

  const chatsCollection = getChatsCollection();
  const chat = await chatsCollection.findOne({ _id: chatObjectId });

  if (!chat) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Chat not found',
    });
  }

  const isParticipant = chat.participants.some((participantId) =>
    participantId.equals(userObjectId)
  );
  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }
  if (isChatExpired(chat)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'This temporary group has ended',
    });
  }

  const db = getDatabase();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const readState = await db
    .collection('chatReadStates')
    .findOne<{ lastReadAt?: Date }>({ chatId: chatObjectId, userId: userObjectId });
  const lastReadAt = readState?.lastReadAt;
  const unreadCount = lastReadAt
    ? await messagesCollection.countDocuments({
        chatId: chatObjectId,
        deletedFor: { $ne: userObjectId },
        'momentReply.isMomentReply': { $ne: true },
        senderId: { $ne: userObjectId },
        createdAt: { $gt: lastReadAt },
      })
    : 0;

  const baseQuery: Record<string, unknown> = {
    chatId: chatObjectId,
    deletedFor: { $ne: userObjectId },
    'momentReply.isMomentReply': { $ne: true },
  };
  if (unreadCount > 0 && lastReadAt) {
    baseQuery.createdAt = { $gt: lastReadAt };
  }

  const rawMessages = await messagesCollection
    .find(baseQuery)
    .sort({ createdAt: -1 })
    .limit(messageLimit)
    .toArray();

  if (rawMessages.length === 0) {
    const now = new Date();
    const emptySummary = {
      summary: 'No recent messages are available to summarize yet.',
      overview: 'No recent messages are available to summarize yet.',
      scope: {
        label: 'Last 0 messages',
        messageCount: 0,
        mode: 'recent' as const,
      },
      decisions: [],
      tasks: [],
      questionsForMe: [],
      importantLinks: [],
      waitingOn: [],
      noise: [],
      sourceMessageIds: [],
      sources: [],
      generatedAt: now.toISOString(),
    };

    logger.info(
      { chatId, userId, sourceMessages: 0, messageLimit, feature: 'catch_me_up' },
      'Chat summary skipped because no messages were available'
    );

    return res.status(200).json({ summary: emptySummary });
  }

  const participantIds = chat.participants.map((participantId) => participantId.toString());
  const senderIds = Array.from(
    new Set([userId, ...participantIds, ...rawMessages.map((message) => message.senderId.toString())])
  ).map((id) => new ObjectId(id));
  const userDocs = await db
    .collection<UserDocument>('users')
    .find({ _id: { $in: senderIds } })
    .project<UserDocument>({ _id: 1, username: 1, email: 1, name: 1 })
    .toArray();
  const userNamesById = new Map(
    userDocs.map((user) => [
      user._id.toString(),
      displayName(user),
    ])
  );
  const participantById = new Map(
    userDocs
      .filter((user) => participantIds.includes(user._id.toString()))
      .map((user) => [user._id.toString(), user])
  );
  const participantByName = new Map<string, UserDocument>();
  for (const user of participantById.values()) {
    const name = normalizeName(user.name);
    const username = normalizeName(user.username);
    if (name) participantByName.set(name, user);
    if (username) participantByName.set(username, user);
  }

  const contextMessages: SummaryInputMessage[] = rawMessages
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
  const messageById = new Map(contextMessages.map((message) => [message._id, message]));

  const summaryService = createAISummaryService();
  const summary = await summaryService.generateSummary({
    chatId,
    currentUserId: userId,
    currentUserName: userNamesById.get(userId) ?? null,
    chatTitle: chat.title ?? null,
    chatDescription: chat.description || chat.groupContext || null,
    groupContext: chat.description || chat.groupContext || null,
    participants: Array.from(participantById.values()).map((user) => ({
      userId: user._id.toString(),
      name: displayName(user),
    })),
    messages: contextMessages,
  });

  const parsedSummary = ChatIntelligenceSummarySchema.safeParse(summary);
  if (!parsedSummary.success) {
    logger.error(
      { issues: parsedSummary.error.flatten() },
      'Generated summary failed schema validation'
    );
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Summary generation produced invalid structured output',
    });
  }

  const now = new Date();
  const viewer = userDocs.find((user) => user._id.equals(userObjectId));
  const scopedSummary = personalizeSummary({
    summary: {
    ...parsedSummary.data,
    overview: parsedSummary.data.overview || parsedSummary.data.summary,
    tasks: parsedSummary.data.tasks.map((task) => {
      const owner = resolveTaskOwner({
        assignedTo: task.assignedTo,
        assignedToUserId: task.assignedToUserId,
        sourceMessageId: task.sourceMessageId,
        participantById,
        participantByName,
        messageById,
      });
      return {
        ...task,
        ...owner,
        dueDate: resolveSummaryDueDate(task.dueDate, messageById.get(task.sourceMessageId)?.createdAt),
      };
    }),
    scope: {
      label:
        unreadCount > 0
          ? `${rawMessages.length} unread messages${lastReadAt ? ` since ${lastReadAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
          : `Last ${rawMessages.length} messages`,
      messageCount: rawMessages.length,
      since: unreadCount > 0 && lastReadAt ? lastReadAt.toISOString() : undefined,
      mode: unreadCount > 0 ? 'unread' as const : 'recent' as const,
    },
    },
    messages: rawMessages,
    viewer: viewer || { _id: userObjectId, name: userNamesById.get(userId) },
  });
  const sourcedSummary = await materializeSummarySources({
    summary: scopedSummary,
    chatId: chatObjectId,
    userId: userObjectId,
  });
  await getChatSummariesCollection().insertOne({
    _id: new ObjectId(),
    chatId: chatObjectId,
    generatedByUserId: userObjectId,
    summary: scopedSummary,
    createdAt: now,
    updatedAt: now,
  });

  logger.info(
    {
      chatId,
      userId,
      sourceMessages: sourcedSummary.sourceMessageIds.length,
      messageLimit,
    },
    'Chat summary generated'
  );

  return res.status(200).json({ summary: sourcedSummary });
});
