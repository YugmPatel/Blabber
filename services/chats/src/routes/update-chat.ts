import { Request, Response } from 'express';
import { EventType, UpdateChatDTOSchema, type ChatUpdatedEvent } from '@repo/types';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { serializeChat } from '../serialize-chat';
import { getPubSub } from '../pubsub';

/**
 * Update group chat metadata (admin only)
 */
export const updateChat = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validationResult = UpdateChatDTOSchema.safeParse(req.body);

  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: validationResult.error.errors[0].message,
      details: validationResult.error.errors,
    });
  }

  const { title, description, groupContext, avatarUrl, expiresAt } = validationResult.data;

  // Check if at least one field is provided
  if (
    title === undefined &&
    description === undefined &&
    groupContext === undefined &&
    avatarUrl === undefined &&
    expiresAt === undefined
  ) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'At least one field must be provided',
    });
  }

  // Get chat from RBAC middleware
  const chat = (req as any).chat;
  if (!chat) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Chat not found in request context',
    });
  }

  // Build update object
  const updateFields: any = {
    updatedAt: new Date(),
  };

  if (title !== undefined) {
    updateFields.title = title;
  }

  const unsetFields: Record<string, string> = {};

  if (avatarUrl !== undefined) {
    if (avatarUrl === '') {
      unsetFields.avatarUrl = '';
    } else {
      updateFields.avatarUrl = avatarUrl;
    }
  }
  if (description !== undefined) {
    updateFields.description = description;
  }
  if (groupContext !== undefined) {
    updateFields.groupContext = groupContext;
  }
  if (expiresAt !== undefined) {
    const expiresDate = new Date(expiresAt);
    if (chat.groupKind !== 'temporary' || Number.isNaN(expiresDate.getTime()) || expiresDate <= new Date()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Temporary group extensions require a future expiration time',
      });
    }
    updateFields.expiresAt = expiresDate;
  }

  const update: any = { $set: updateFields };
  if (expiresAt !== undefined) {
    unsetFields.endedAt = '';
  }
  if (Object.keys(unsetFields).length > 0) {
    update.$unset = unsetFields;
  }

  // Update chat
  const collection = getChatsCollection();
  const result = await collection.updateOne({ _id: chat._id }, update);

  if (result.modifiedCount === 0) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update chat',
    });
  }

  // Fetch updated chat
  const updatedChat = await collection.findOne({ _id: chat._id });

  if (!updatedChat) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve updated chat',
    });
  }

  const serializedChat = await serializeChat(updatedChat, { includeParticipants: true });
  try {
    await getPubSub().publish(
      createEvent<ChatUpdatedEvent>(EventType.CHAT_UPDATED, {
        chatId: updatedChat._id.toString(),
        name: updatedChat.title,
        avatar: updatedChat.avatarUrl,
        updatedBy: (req as any).user?.userId || 'system',
      })
    );
  } catch (error) {
    logger.error({ error, chatId: updatedChat._id.toString() }, 'Failed to publish chat updated event');
  }

  return res.status(200).json({
    chat: serializedChat,
  });
});
