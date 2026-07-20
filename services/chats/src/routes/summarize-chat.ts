import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { AppError, asyncHandler, logger } from '@repo/utils';
import { ChatIntelligenceSummarySchema, SummarizeChatDTOSchema } from '@repo/types';
import { getChatsCollection } from '../models/chat';
import { getChatSummariesCollection } from '../models/chat-summary';
import { isChatExpired } from '../serialize-chat';
import { getDatabase } from '../db';
import {
  createAISummaryService,
  type SummaryInputMessage,
} from '../intelligence/ai-summary-service';
import { buildHeuristicSummary } from '../intelligence/heuristic-summary';
import { materializeSummarySources } from '../intelligence-source-materializer';
import { personalizeSummary } from '../summary-personalization';

interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  type?: string;
  body: string;
  media?: {
    type?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    duration?: number;
  };
  poll?: {
    question?: string;
    options?: Array<{
      id?: string;
      text?: string;
      votes?: ObjectId[];
      voteCount?: number;
    }>;
    allowMultiple?: boolean;
    closesAt?: Date;
    closedAt?: Date;
    closed?: boolean;
    votes?: Array<{
      userId: ObjectId;
      optionIds: string[];
      votedAt?: Date;
      updatedAt?: Date;
    }>;
  };
  event?: {
    title?: string;
    startAt?: Date;
    startsAt?: string;
    endAt?: Date;
    timezone?: string;
    location?: string;
    meetingUrl?: string;
    description?: string;
    cancelledAt?: Date;
    rsvps?: Array<{
      userId: ObjectId;
      status: 'going' | 'maybe' | 'declined';
    }>;
  };
  planThis?: {
    planId?: ObjectId;
    kind?: 'proposal' | 'finalized' | 'updated' | 'cancelled';
    planVersion?: number;
    title?: string;
    status?: string;
    createdAt?: Date;
    updatedAt?: Date;
  };
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

function dateToIso(value?: Date | string | null) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function maybeObjectIdToString(value?: ObjectId | string | null) {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.toString();
}

function serializePollForSummary(message: MessageDocument): SummaryInputMessage['poll'] {
  const poll = message.poll;
  if (!poll) return undefined;
  const voteRecords = poll.votes || [];
  return {
    question: poll.question,
    options: (poll.options || []).map((option) => ({
      id: option.id,
      text: option.text,
      voteCount:
        option.voteCount ??
        voteRecords.filter((vote) => option.id && vote.optionIds.includes(option.id)).length ??
        option.votes?.length ??
        0,
      votes: (option.votes || []).map((vote) => vote.toString()),
    })),
    allowMultiple: poll.allowMultiple,
    closesAt: dateToIso(poll.closesAt),
    closedAt: dateToIso(poll.closedAt),
    closed: Boolean(poll.closed || poll.closedAt || (poll.closesAt && poll.closesAt.getTime() <= Date.now())),
    votes: voteRecords.map((vote) => ({
      userId: vote.userId.toString(),
      optionIds: vote.optionIds,
      votedAt: dateToIso(vote.votedAt),
      updatedAt: dateToIso(vote.updatedAt),
    })),
  };
}

function serializeEventForSummary(message: MessageDocument): SummaryInputMessage['event'] {
  const event = message.event;
  if (!event) return undefined;
  return {
    title: event.title,
    startAt: dateToIso(event.startAt) || event.startsAt,
    endAt: dateToIso(event.endAt),
    timezone: event.timezone,
    location: event.location,
    meetingUrl: event.meetingUrl,
    description: event.description,
    cancelledAt: dateToIso(event.cancelledAt),
    rsvps: event.rsvps?.map((rsvp) => ({
      userId: rsvp.userId.toString(),
      status: rsvp.status,
    })),
  };
}

function resolveSummaryDueDate(value: string | null | undefined, sourceCreatedAt?: string): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const base = sourceCreatedAt ? new Date(sourceCreatedAt) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const lower = raw.toLowerCase();
  const next = new Date(base);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (lower === 'today' || lower === 'tonight' || lower.includes('end of day') || lower === 'eod') return dateInputValue(base);
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
  // An ended temporary group with "end only" behavior stays readable in the
  // app, so a historical Catch Me Up is still allowed for members. Deleted
  // chats and end-and-delete groups (even if the expiry sweep hasn't marked
  // deletedAt yet) are inaccessible.
  const chatInaccessible =
    Boolean(chat.deletedAt) ||
    (chat.groupKind === 'temporary' && chat.temporaryCompletionBehavior === 'end_and_delete' && isChatExpired(chat));
  if (chatInaccessible) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'This chat is no longer available to summarize',
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
      media: message.media
        ? {
            type: message.media.type,
            fileName: message.media.fileName,
            mimeType: message.media.mimeType,
            size: message.media.size,
            duration: message.media.duration,
          }
        : undefined,
      poll: serializePollForSummary(message),
      event: serializeEventForSummary(message),
      planThis: message.planThis
        ? {
            planId: maybeObjectIdToString(message.planThis.planId),
            kind: message.planThis.kind,
            planVersion: message.planThis.planVersion,
            title: message.planThis.title,
            status: message.planThis.status,
            createdAt: dateToIso(message.planThis.createdAt),
            updatedAt: dateToIso(message.planThis.updatedAt),
          }
        : undefined,
    }));
  const messageById = new Map(contextMessages.map((message) => [message._id, message]));

  const summaryContext = {
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
  };

  const summaryService = createAISummaryService();
  let summary;
  try {
    summary = await summaryService.generateSummary(summaryContext);
  } catch (error) {
    // "AI not configured at all" keeps its explicit 503 (surfaced by the
    // availability endpoint too). Every other failure — provider, network,
    // schema — degrades to the grounded deterministic summary instead of a
    // user-facing 5xx. Defense in depth: the service normally falls back on
    // its own; this catch also covers unexpected throw paths.
    if (error instanceof AppError && error.code === 'AI_NOT_CONFIGURED') throw error;
    logger.warn(
      {
        chatId,
        feature: 'catch_me_up',
        reason: error instanceof Error ? error.message : 'unknown_summary_error',
      },
      'Summary generation failed; serving deterministic heuristic summary'
    );
    summary = buildHeuristicSummary(summaryContext);
  }

  let parsedSummary = ChatIntelligenceSummarySchema.safeParse(summary);
  if (!parsedSummary.success) {
    logger.warn(
      { issues: parsedSummary.error.flatten(), chatId, feature: 'catch_me_up' },
      'Generated summary failed schema validation; serving deterministic heuristic summary'
    );
    parsedSummary = ChatIntelligenceSummarySchema.safeParse(buildHeuristicSummary(summaryContext));
    if (!parsedSummary.success) {
      // The heuristic output is schema-shaped by construction, so this is
      // effectively unreachable — kept as a last-resort guard.
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Summary generation produced invalid structured output',
      });
    }
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
