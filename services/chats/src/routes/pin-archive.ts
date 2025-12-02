import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getUserChatPreferencesCollection } from '../models/user-chat-preferences';

/**
 * Pin a chat for the authenticated user
 */
export const pinChat = asyncHandler(async (req: Request, res: Response) => {
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

  // Verify chat exists and user is a participant
  const chatsCollection = getChatsCollection();
  const chat = await chatsCollection.findOne({ _id: chatId });

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

  // Update or create user chat preferences
  const preferencesCollection = getUserChatPreferencesCollection();
  const now = new Date();

  await preferencesCollection.updateOne(
    { userId: userObjectId, chatId },
    {
      $set: {
        pinned: true,
        updatedAt: now,
      },
      $setOnInsert: {
        userId: userObjectId,
        chatId,
        archived: false,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return res.status(200).json({
    success: true,
    message: 'Chat pinned successfully',
  });
});

/**
 * Unpin a chat for the authenticated user
 */
export const unpinChat = asyncHandler(async (req: Request, res: Response) => {
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

  // Update user chat preferences
  const preferencesCollection = getUserChatPreferencesCollection();
  await preferencesCollection.updateOne(
    { userId: userObjectId, chatId },
    {
      $set: {
        pinned: false,
        updatedAt: new Date(),
      },
    }
  );

  return res.status(200).json({
    success: true,
    message: 'Chat unpinned successfully',
  });
});

/**
 * Archive a chat for the authenticated user
 */
export const archiveChat = asyncHandler(async (req: Request, res: Response) => {
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

  // Verify chat exists and user is a participant
  const chatsCollection = getChatsCollection();
  const chat = await chatsCollection.findOne({ _id: chatId });

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

  // Update or create user chat preferences
  const preferencesCollection = getUserChatPreferencesCollection();
  const now = new Date();

  await preferencesCollection.updateOne(
    { userId: userObjectId, chatId },
    {
      $set: {
        archived: true,
        updatedAt: now,
      },
      $setOnInsert: {
        userId: userObjectId,
        chatId,
        pinned: false,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return res.status(200).json({
    success: true,
    message: 'Chat archived successfully',
  });
});

/**
 * Unarchive a chat for the authenticated user
 */
export const unarchiveChat = asyncHandler(async (req: Request, res: Response) => {
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

  // Update user chat preferences
  const preferencesCollection = getUserChatPreferencesCollection();
  await preferencesCollection.updateOne(
    { userId: userObjectId, chatId },
    {
      $set: {
        archived: false,
        updatedAt: new Date(),
      },
    }
  );

  return res.status(200).json({
    success: true,
    message: 'Chat unarchived successfully',
  });
});
