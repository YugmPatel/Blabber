import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';

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
  const archived = req.query.archived === 'true';

  // Build query - filter by participants array
  const query: any = {
    participants: userObjectId,
  };

  // Note: archived functionality would require additional user-specific metadata
  // For now, we'll just list all chats for the user

  const collection = getChatsCollection();

  // Find chats and sort by updatedAt descending
  const chats = await collection.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();

  // Serialize chats for response
  const serializedChats = chats.map((chat) => {
    const serialized: any = {
      _id: chat._id.toString(),
      type: chat.type,
      participants: chat.participants.map((id) => id.toString()),
      admins: chat.admins.map((id) => id.toString()),
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };

    // Include optional fields if they exist
    if (chat.title) {
      serialized.title = chat.title;
    }
    if (chat.avatarUrl) {
      serialized.avatarUrl = chat.avatarUrl;
    }
    if (chat.lastMessageRef) {
      serialized.lastMessageRef = {
        messageId: chat.lastMessageRef.messageId.toString(),
        body: chat.lastMessageRef.body,
        senderId: chat.lastMessageRef.senderId.toString(),
        createdAt: chat.lastMessageRef.createdAt,
      };
    }

    return serialized;
  });

  return res.status(200).json({
    chats: serializedChats,
  });
});
