import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { CreateChatDTOSchema } from '@repo/types';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';

export const createChat = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validationResult = CreateChatDTOSchema.safeParse(req.body);

  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: validationResult.error.errors[0].message,
      details: validationResult.error.errors,
    });
  }

  const { type, participantIds, title, avatarUrl } = validationResult.data;

  // Get authenticated user ID from middleware
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  // Convert participant IDs to ObjectIds
  let participantObjectIds = participantIds.map((id) => new ObjectId(id));

  // For direct chats, validate exactly 2 participants before adding creator
  if (type === 'direct' && participantObjectIds.length !== 2) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Direct chats must have exactly 2 participants',
    });
  }

  // Ensure the creator is in the participants list (for group chats)
  const creatorObjectId = new ObjectId(userId);
  if (type === 'group' && !participantObjectIds.some((id) => id.equals(creatorObjectId))) {
    participantObjectIds.push(creatorObjectId);
  }

  // For group chats, set creator as initial admin
  const admins = type === 'group' ? [creatorObjectId] : [];

  // Create chat document
  const now = new Date();
  const chat = {
    type,
    participants: participantObjectIds,
    admins,
    title: type === 'group' ? title : undefined,
    avatarUrl,
    createdAt: now,
    updatedAt: now,
  };

  const collection = getChatsCollection();
  const result = await collection.insertOne(chat as any);

  // Return created chat
  const createdChat = await collection.findOne({ _id: result.insertedId });

  if (!createdChat) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve created chat',
    });
  }

  // Serialize chat for response
  const serializedChat: any = {
    _id: createdChat._id.toString(),
    type: createdChat.type,
    participants: createdChat.participants.map((id) => id.toString()),
    admins: createdChat.admins.map((id) => id.toString()),
    createdAt: createdChat.createdAt,
    updatedAt: createdChat.updatedAt,
  };

  // Only include optional fields if they exist
  if (createdChat.title) {
    serializedChat.title = createdChat.title;
  }
  if (createdChat.avatarUrl) {
    serializedChat.avatarUrl = createdChat.avatarUrl;
  }
  if (createdChat.lastMessageRef) {
    serializedChat.lastMessageRef = createdChat.lastMessageRef;
  }

  return res.status(201).json({
    chat: serializedChat,
  });
});
