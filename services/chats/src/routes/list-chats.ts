import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getDatabase } from '../db';
import { serializeChat } from '../serialize-chat';

export const listChats = asyncHandler(async (req: Request, res: Response) => {
  // Get authenticated user ID from middleware
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  const userObjectId = new ObjectId(userId);

  // Get query parameters
  const limit = parseInt(req.query.limit as string) || 50;
  const archivedOnly = req.query.archived === 'true';

  // Build query - filter by participants array
  const query: any = {
    participants: userObjectId,
    deletedAt: { $exists: false },
  };

  const collection = getChatsCollection();
  const db = getDatabase();
  const preferences = await db
    .collection('userChatPreferences')
    .find({ userId: userObjectId })
    .toArray();
  const archivedByChatId = new Map(
    preferences
      .filter((preference: any) => preference.archived)
      .map((preference: any) => [preference.chatId.toString(), preference])
  );

  // Find chats and sort by updatedAt descending
  const allChats = await collection.find(query).sort({ updatedAt: -1 }).limit(limit * 2).toArray();
  const chats = allChats
    .filter((chat) => archivedOnly === archivedByChatId.has(chat._id.toString()))
    .slice(0, limit);
  const chatIds = chats.map((chat) => chat._id);
  const unreadCounts = await db
    .collection('messages')
    .aggregate<{ _id: ObjectId; count: number }>([
      {
        $match: {
          chatId: { $in: chatIds },
          senderId: { $ne: userObjectId },
          deletedFor: { $ne: userObjectId },
        },
      },
      {
        $lookup: {
          from: 'chatReadStates',
          let: { messageChatId: '$chatId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$chatId', '$$messageChatId'] },
                    { $eq: ['$userId', userObjectId] },
                  ],
                },
              },
            },
            { $project: { lastReadAt: 1 } },
          ],
          as: 'readState',
        },
      },
      {
        $addFields: {
          lastReadAt: {
            $ifNull: [{ $arrayElemAt: ['$readState.lastReadAt', 0] }, new Date(0)],
          },
        },
      },
      {
        $match: {
          $expr: { $gt: ['$createdAt', '$lastReadAt'] },
        },
      },
      { $group: { _id: '$chatId', count: { $sum: 1 } } },
    ])
    .toArray();
  const unreadCountByChatId = new Map(
    unreadCounts.map((entry) => [entry._id.toString(), entry.count])
  );
  const mentionUnreadCounts = await db
    .collection('messages')
    .aggregate<{ _id: ObjectId; count: number }>([
      {
        $match: {
          chatId: { $in: chatIds },
          senderId: { $ne: userObjectId },
          'mentions.userId': userObjectId,
          deletedFor: { $ne: userObjectId },
        },
      },
      {
        $lookup: {
          from: 'chatReadStates',
          let: { messageChatId: '$chatId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$chatId', '$$messageChatId'] },
                    { $eq: ['$userId', userObjectId] },
                  ],
                },
              },
            },
            { $project: { lastReadAt: 1 } },
          ],
          as: 'readState',
        },
      },
      { $addFields: { lastReadAt: { $ifNull: [{ $arrayElemAt: ['$readState.lastReadAt', 0] }, new Date(0)] } } },
      { $match: { $expr: { $gt: ['$createdAt', '$lastReadAt'] } } },
      { $group: { _id: '$chatId', count: { $sum: 1 } } },
    ])
    .toArray();
  const mentionUnreadCountByChatId = new Map(
    mentionUnreadCounts.map((entry) => [entry._id.toString(), entry.count])
  );

  // Serialize chats for response
  const serializedChats = (
    await Promise.all(
      chats.map(async (chat) => ({
        ...(await serializeChat(chat, { includeParticipants: true, viewerId: userObjectId })),
        unreadCount: unreadCountByChatId.get(chat._id.toString()) || 0,
        mentionUnreadCount: chat.type === 'group' ? mentionUnreadCountByChatId.get(chat._id.toString()) || 0 : 0,
        archived: archivedByChatId.has(chat._id.toString()),
        archivedAt: archivedByChatId.get(chat._id.toString())?.archivedAt,
      }))
    )
  ).filter((chat) => !chat.deletedAt);

  return res.status(200).json({
    chats: serializedChats,
  });
});
