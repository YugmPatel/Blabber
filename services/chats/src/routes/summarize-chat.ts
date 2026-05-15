import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger } from '@repo/utils';
import { ChatIntelligenceSummarySchema, SummarizeChatDTOSchema } from '@repo/types';
import { getChatsCollection } from '../models/chat';
import { getChatSummariesCollection } from '../models/chat-summary';
import { getDatabase } from '../db';
import {
  createAISummaryService,
  type SummaryInputMessage,
} from '../intelligence/ai-summary-service';

interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  body: string;
  createdAt: Date;
  deletedFor: ObjectId[];
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

  const isParticipant = chat.participants.some((participantId) => participantId.equals(userObjectId));
  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }

  const db = getDatabase();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const rawMessages = await messagesCollection
    .find({
      chatId: chatObjectId,
      deletedFor: { $ne: userObjectId },
    })
    .sort({ createdAt: -1 })
    .limit(messageLimit)
    .toArray();

  const contextMessages: SummaryInputMessage[] = rawMessages
    .slice()
    .reverse()
    .map((message) => ({
      _id: message._id.toString(),
      senderId: message.senderId.toString(),
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    }));

  const summaryService = createAISummaryService();
  const summary = await summaryService.generateSummary({
    chatId,
    currentUserId: userId,
    messages: contextMessages,
  });

  const parsedSummary = ChatIntelligenceSummarySchema.safeParse(summary);
  if (!parsedSummary.success) {
    logger.error({ issues: parsedSummary.error.flatten() }, 'Generated summary failed schema validation');
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Summary generation produced invalid structured output',
    });
  }

  const now = new Date();
  await getChatSummariesCollection().insertOne({
    _id: new ObjectId(),
    chatId: chatObjectId,
    generatedByUserId: userObjectId,
    summary: parsedSummary.data,
    createdAt: now,
    updatedAt: now,
  });

  logger.info(
    {
      chatId,
      userId,
      sourceMessages: parsedSummary.data.sourceMessageIds.length,
      messageLimit,
    },
    'Chat summary generated'
  );

  return res.status(200).json({ summary: parsedSummary.data });
});