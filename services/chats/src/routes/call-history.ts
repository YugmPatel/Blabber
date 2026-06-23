import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getCallHistoryCollection, type CallOutcome } from '../models/call-history';
import { getDatabase } from '../db';

function serializeCall(doc: any, chatTitle?: string, participantProfiles: any[] = []) {
  return {
    id: doc._id.toString(),
    callId: doc.callId,
    chatId: doc.chatId.toString(),
    chatTitle,
    chatType: doc.chatType,
    callType: doc.callType,
    callerId: doc.callerId.toString(),
    participantIds: doc.participantIds.map((id: ObjectId) => id.toString()),
    participantProfiles,
    outcome: doc.outcome,
    startedAt: doc.startedAt,
    answeredAt: doc.answeredAt,
    endedAt: doc.endedAt,
    durationSeconds: doc.durationSeconds,
    note: doc.note,
  };
}

export const listCallHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = new ObjectId(userId);
  const calls = await getCallHistoryCollection()
    .find({ participantIds: userObjectId })
    .sort({ startedAt: -1 })
    .limit(100)
    .toArray();

  const chatIds = Array.from(new Set(calls.map((call) => call.chatId.toString()))).map((id) => new ObjectId(id));
  const chats = await getChatsCollection()
    .find({ _id: { $in: chatIds }, participants: userObjectId, deletedAt: { $exists: false } })
    .project({ _id: 1, title: 1, type: 1, participants: 1 })
    .toArray();
  const chatById = new Map(chats.map((chat) => [chat._id.toString(), chat]));

  const userIds = Array.from(new Set(calls.flatMap((call) => call.participantIds.map((id) => id.toString())))).map((id) => new ObjectId(id));
  const users = await getDatabase()
    .collection('users')
    .find({ _id: { $in: userIds } })
    .project({ _id: 1, name: 1, username: 1, email: 1, avatarUrl: 1 })
    .toArray();
  const userById = new Map(users.map((user) => [user._id.toString(), user]));

  const authorizedCalls = calls.filter((call) => chatById.has(call.chatId.toString()));
  return res.status(200).json({
    calls: authorizedCalls.map((call) => {
      const chat = chatById.get(call.chatId.toString());
      return serializeCall(
        call,
        chat?.title,
        call.participantIds.map((id) => {
          const user = userById.get(id.toString());
          return {
            _id: id.toString(),
            name: user?.name || user?.username || user?.email || id.toString(),
            avatarUrl: user?.avatarUrl,
          };
        })
      );
    }),
  });
});

export const recordCallEvent = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const { callId, chatId, callType, targetUserId, event } = req.body ?? {};
  if (!callId || !ObjectId.isValid(chatId) || !event) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid call event payload' });
  }

  const callerObjectId = new ObjectId(userId);
  const chat = await getChatsCollection().findOne({
    _id: new ObjectId(chatId),
    participants: callerObjectId,
    deletedAt: { $exists: false },
  });
  if (!chat) {
    return res.status(403).json({ error: 'Forbidden', message: 'Call chat is not available' });
  }

  const participantIds =
    targetUserId && ObjectId.isValid(targetUserId)
      ? Array.from(new Set([userId, targetUserId])).map((id) => new ObjectId(id))
      : chat.participants;
  const now = new Date();
  const collection = getCallHistoryCollection();

  if (event === 'invite') {
    if (!['audio', 'video'].includes(callType)) {
      return res.status(400).json({ error: 'Validation Error', message: 'Invalid call type' });
    }
    await collection.updateOne(
      { callId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          callId,
          chatId: chat._id,
          chatType: chat.type,
          callType,
          callerId: callerObjectId,
          participantIds,
          outcome: 'ringing',
          startedAt: now,
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true }
    );
    return res.status(200).json({ success: true });
  }

  const existing = await collection.findOne({ callId });
  if (!existing) return res.status(200).json({ success: true });

  const outcomeByEvent: Record<string, CallOutcome> = {
    accept: 'answered',
    decline: 'declined',
    cancel: 'cancelled',
    end: existing.outcome === 'answered' ? 'ended' : 'missed',
  };
  const outcome = outcomeByEvent[event] || existing.outcome;
  const update: any = { outcome, updatedAt: now };
  if (event === 'accept') update.answeredAt = now;
  if (event === 'decline' || event === 'cancel' || event === 'end') {
    update.endedAt = now;
    const start = existing.answeredAt || (event === 'end' && existing.outcome === 'answered' ? existing.startedAt : undefined);
    if (start) update.durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(start).getTime()) / 1000));
  }

  await collection.updateOne({ callId }, { $set: update });
  return res.status(200).json({ success: true });
});
