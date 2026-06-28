import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getDatabase } from '../db';
import { isChatExpired } from '../serialize-chat';
import { getCallHistoryCollection } from '../models/call-history';

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function signLiveKitToken(payload: Record<string, unknown>, secret: string) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function safeRoomName(chatId: string) {
  return `blabber-group-${chatId}`;
}

function normalizeClientSessionId(value: unknown) {
  if (typeof value !== 'string') return 'default';
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return normalized || 'default';
}

export const createGroupCallToken = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const { id: chatId } = req.params;
  const callType = req.body?.callType === 'audio' ? 'audio' : 'video';
  const isInitiator = req.body?.isInitiator === true;
  const clientSessionId = normalizeClientSessionId(req.body?.clientSessionId);
  const callId = typeof req.body?.callId === 'string' && req.body.callId.trim()
    ? req.body.callId.trim()
    : `group-${chatId}-${Date.now()}`;

  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }
  if (!ObjectId.isValid(chatId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }

  const userObjectId = new ObjectId(userId);
  const chatObjectId = new ObjectId(chatId);
  const chat = await getChatsCollection().findOne({ _id: chatObjectId, deletedAt: { $exists: false } });
  if (!chat || chat.type !== 'group') {
    return res.status(404).json({ error: 'Not Found', message: 'Group chat not found' });
  }
  if (!chat.participants.some((participantId) => participantId.equals(userObjectId))) {
    return res.status(403).json({ error: 'Forbidden', message: 'You are not a member of this group' });
  }
  if (isChatExpired(chat)) {
    return res.status(400).json({ error: 'Validation Error', message: 'This temporary group has ended' });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_WS_URL || process.env.PUBLIC_LIVEKIT_WS_URL;
  if (!apiKey || !apiSecret || !wsUrl) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Group calling is not configured on this server',
    });
  }

  const user = await getDatabase()
    .collection('users')
    .findOne({ _id: userObjectId }, { projection: { name: 1, username: 1, email: 1 } });
  const displayName = user?.name || user?.username || user?.email || userId;
  const room = safeRoomName(chatId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = signLiveKitToken(
    {
      iss: apiKey,
      sub: userId,
      name: displayName,
      nbf: nowSeconds - 10,
      exp: nowSeconds + 60 * 60 * 2,
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    },
    apiSecret
  );

  const now = new Date();
  const callHistory = getCallHistoryCollection();
  const existingCall = await callHistory.findOne({ callId, chatId: chatObjectId });
  const activeParticipantKey = `${userId}:${clientSessionId}`;

  if (existingCall?.endedAt) {
    return res.status(410).json({
      error: 'Gone',
      message: 'This group call has ended',
    });
  }

  if (existingCall && existingCall.callType !== callType) {
    return res.status(409).json({
      error: 'Conflict',
      message: 'This invite does not match the active group call',
    });
  }

  if (!existingCall && !isInitiator) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'This group call is no longer active',
    });
  }

  if (!existingCall) {
    await callHistory.insertOne({
      _id: new ObjectId(),
      callId,
      chatId: chatObjectId,
      chatType: 'group',
      callType,
      callerId: userObjectId,
      participantIds: chat.participants,
      activeParticipantIds: [userObjectId],
      activeParticipantKeys: [activeParticipantKey],
      outcome: 'ringing',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await callHistory.updateOne(
      { callId, chatId: chatObjectId },
      {
        $addToSet: {
          activeParticipantIds: userObjectId,
          activeParticipantKeys: activeParticipantKey,
        },
        $set: { updatedAt: now },
      }
    );
  }

  if (!isInitiator) {
    await callHistory.updateOne(
      { callId, chatId: chatObjectId },
      {
        $addToSet: {
          activeParticipantIds: userObjectId,
          activeParticipantKeys: activeParticipantKey,
        },
        $set: {
          outcome: 'answered',
          answeredAt: now,
          updatedAt: now,
        },
      }
    );
  }

  return res.status(200).json({ token, wsUrl, room, callId, callType });
});

export const getActiveGroupCall = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const { id: chatId } = req.params;

  if (!userId || !ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }
  if (!ObjectId.isValid(chatId)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Invalid chat ID' });
  }

  const userObjectId = new ObjectId(userId);
  const chatObjectId = new ObjectId(chatId);
  const chat = await getChatsCollection().findOne({ _id: chatObjectId, deletedAt: { $exists: false } });
  if (!chat || chat.type !== 'group') {
    return res.status(404).json({ error: 'Not Found', message: 'Group chat not found' });
  }
  if (!chat.participants.some((participantId) => participantId.equals(userObjectId))) {
    return res.status(403).json({ error: 'Forbidden', message: 'You are not a member of this group' });
  }
  if (isChatExpired(chat)) {
    return res.status(200).json({ activeCall: null });
  }

  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const activeCall = await getCallHistoryCollection().findOne(
    {
      chatId: chatObjectId,
      chatType: 'group',
      participantIds: userObjectId,
      $or: [
        { activeParticipantKeys: { $exists: true, $ne: [] } },
        { activeParticipantIds: { $exists: true, $ne: [] } },
      ],
      outcome: { $in: ['ringing', 'answered'] },
      endedAt: { $exists: false },
      startedAt: { $gte: staleBefore },
    },
    { sort: { startedAt: -1 } }
  );

  return res.status(200).json({
    activeCall: activeCall
      ? {
          callId: activeCall.callId,
          chatId: activeCall.chatId.toString(),
          callType: activeCall.callType,
          callerId: activeCall.callerId.toString(),
          startedAt: activeCall.startedAt,
        }
      : null,
  });
});
