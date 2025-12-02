import { Request, Response } from 'express';
import { UpdateChatDTOSchema } from '@repo/types';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';

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

  const { title, avatarUrl } = validationResult.data;

  // Check if at least one field is provided
  if (!title && !avatarUrl) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'At least one field (title or avatarUrl) must be provided',
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

  if (avatarUrl !== undefined) {
    updateFields.avatarUrl = avatarUrl;
  }

  // Update chat
  const collection = getChatsCollection();
  const result = await collection.updateOne({ _id: chat._id }, { $set: updateFields });

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

  // Serialize chat for response
  const serializedChat: any = {
    _id: updatedChat._id.toString(),
    type: updatedChat.type,
    participants: updatedChat.participants.map((id) => id.toString()),
    admins: updatedChat.admins.map((id) => id.toString()),
    createdAt: updatedChat.createdAt,
    updatedAt: updatedChat.updatedAt,
  };

  if (updatedChat.title) {
    serializedChat.title = updatedChat.title;
  }
  if (updatedChat.avatarUrl) {
    serializedChat.avatarUrl = updatedChat.avatarUrl;
  }
  if (updatedChat.lastMessageRef) {
    serializedChat.lastMessageRef = updatedChat.lastMessageRef;
  }

  return res.status(200).json({
    chat: serializedChat,
  });
});
