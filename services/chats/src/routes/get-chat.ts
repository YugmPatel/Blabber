import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';

export const getChat = asyncHandler(async (req: Request, res: Response) => {
  // Get authenticated user ID from middleware
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  const { id } = req.params;

  // Validate chat ID
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid chat ID',
    });
  }

  const chatId = new ObjectId(id);
  const userObjectId = new ObjectId(userId);

  const collection = getChatsCollection();

  // Find chat by ID
  const chat = await collection.findOne({ _id: chatId });

  if (!chat) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Chat not found',
    });
  }

  // Verify user is a participant
  const isParticipant = chat.participants.some((participantId) =>
    participantId.equals(userObjectId)
  );

  if (!isParticipant) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not a participant in this chat',
    });
  }

  // Serialize chat for response
  const serializedChat: any = {
    _id: chat._id.toString(),
    type: chat.type,
    participants: chat.participants.map((id) => id.toString()),
    admins: chat.admins.map((id) => id.toString()),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };

  // Include optional fields if they exist
  if (chat.title) {
    serializedChat.title = chat.title;
  }
  if (chat.avatarUrl) {
    serializedChat.avatarUrl = chat.avatarUrl;
  }
  if (chat.lastMessageRef) {
    serializedChat.lastMessageRef = {
      messageId: chat.lastMessageRef.messageId.toString(),
      body: chat.lastMessageRef.body,
      senderId: chat.lastMessageRef.senderId.toString(),
      createdAt: chat.lastMessageRef.createdAt,
    };
  }

  return res.status(200).json({
    chat: serializedChat,
  });
});
