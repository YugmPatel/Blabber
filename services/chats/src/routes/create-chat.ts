import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { CreateChatDTOSchema } from '@repo/types';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getDatabase } from '../db';
import { serializeChat } from '../serialize-chat';

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

  const { type, participantIds, title, description, groupContext, avatarUrl, groupKind, expiresAt } = validationResult.data;

  // Get authenticated user ID from middleware
  const userId = (req as any).user?.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'User not authenticated',
    });
  }

  if (!participantIds.every(ObjectId.isValid)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'One or more participant IDs are invalid',
    });
  }

  // Convert participant IDs to ObjectIds and remove duplicates
  let participantObjectIds = Array.from(new Set(participantIds)).map((id) => new ObjectId(id));

  // For direct chats, validate exactly 2 participants before adding creator
  if (type === 'direct' && participantObjectIds.length !== 2) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Direct chats must have exactly 2 participants',
    });
  }

  // Ensure the creator is in the participants list (for group chats)
  const creatorObjectId = new ObjectId(userId);
  if (type === 'direct' && !participantObjectIds.some((id) => id.equals(creatorObjectId))) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You cannot create a direct chat for other users',
    });
  }
  if (type === 'group' && !participantObjectIds.some((id) => id.equals(creatorObjectId))) {
    participantObjectIds.push(creatorObjectId);
  }

  const existingUserCount = await getDatabase()
    .collection('users')
    .countDocuments({ _id: { $in: participantObjectIds } });
  if (existingUserCount !== participantObjectIds.length) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'One or more selected participants do not exist',
    });
  }

  const expiresDate = expiresAt ? new Date(expiresAt) : undefined;
  if (type === 'group' && groupKind === 'temporary') {
    if (!expiresDate || Number.isNaN(expiresDate.getTime()) || expiresDate <= new Date()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Temporary groups require a future expiration time',
      });
    }
  }

  if (type === 'direct') {
    const otherParticipantId = participantObjectIds.find((id) => !id.equals(creatorObjectId));
    const existingBlock = otherParticipantId
      ? await getDatabase().collection('user_blocks').findOne({
          $or: [
            { blockerUserId: creatorObjectId, blockedUserId: otherParticipantId },
            { blockerUserId: otherParticipantId, blockedUserId: creatorObjectId },
          ],
        })
      : null;

    if (existingBlock) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Direct chat is unavailable',
      });
    }
  }

  // For group chats, set creator as initial admin
  const admins = type === 'group' ? [creatorObjectId] : [];

  // Create chat document
  const now = new Date();
  const chat = {
    type,
    participants: participantObjectIds,
    admins,
    ownerId: type === 'group' ? creatorObjectId : undefined,
    title: type === 'group' ? title : undefined,
    description: type === 'group' ? description : undefined,
    groupContext: type === 'group' ? groupContext : undefined,
    avatarUrl,
    groupKind: type === 'group' ? groupKind || 'standard' : undefined,
    aiEnabled: type === 'group' ? true : undefined,
    expiresAt: type === 'group' && groupKind === 'temporary' ? expiresDate : undefined,
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

  const serializedChat = await serializeChat(createdChat, { includeParticipants: true });

  return res.status(201).json({
    chat: serializedChat,
  });
});
