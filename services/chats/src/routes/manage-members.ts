import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { AddMemberDTOSchema } from '@repo/types';
import { asyncHandler } from '@repo/utils';
import { getChatsCollection } from '../models/chat';

/**
 * Add a member to a group chat (admin only)
 */
export const addMember = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validationResult = AddMemberDTOSchema.safeParse(req.body);

  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: validationResult.error.errors[0].message,
      details: validationResult.error.errors,
    });
  }

  const { userId } = validationResult.data;

  // Validate user ID format
  if (!ObjectId.isValid(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid user ID format',
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

  const newMemberId = new ObjectId(userId);

  // Check if user is already a participant
  const isAlreadyParticipant = chat.participants.some((participantId: ObjectId) =>
    participantId.equals(newMemberId)
  );

  if (isAlreadyParticipant) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'User is already a member of this chat',
    });
  }

  // Add member to participants array
  const collection = getChatsCollection();
  const result = await collection.updateOne(
    { _id: chat._id },
    {
      $push: { participants: newMemberId },
      $set: { updatedAt: new Date() },
    }
  );

  if (result.modifiedCount === 0) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add member',
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

/**
 * Remove a member from a group chat (admin only)
 */
export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  // Validate user ID
  if (!ObjectId.isValid(userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid user ID',
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

  const memberToRemoveId = new ObjectId(userId);

  // Check if user is a participant
  const isParticipant = chat.participants.some((participantId: ObjectId) =>
    participantId.equals(memberToRemoveId)
  );

  if (!isParticipant) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'User is not a member of this chat',
    });
  }

  // Prevent removing the last admin
  const isAdmin = chat.admins.some((adminId: ObjectId) => adminId.equals(memberToRemoveId));
  if (isAdmin && chat.admins.length === 1) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Cannot remove the last admin from the group',
    });
  }

  // Remove member from participants and admins arrays
  const collection = getChatsCollection();
  const result = await collection.updateOne(
    { _id: chat._id },
    {
      $pull: {
        participants: memberToRemoveId,
        admins: memberToRemoveId,
      },
      $set: { updatedAt: new Date() },
    }
  );

  if (result.modifiedCount === 0) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove member',
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
