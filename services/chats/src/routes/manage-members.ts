import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import {
  AddMemberDTOSchema,
  EventType,
  UpdateGroupRoleDTOSchema,
  type ChatMemberAddedEvent,
  type ChatMemberRemovedEvent,
  type ChatUpdatedEvent,
} from '@repo/types';
import { asyncHandler, createEvent, logger } from '@repo/utils';
import { getChatsCollection } from '../models/chat';
import { getDatabase } from '../db';
import { isChatExpired, serializeChat } from '../serialize-chat';
import { getPubSub } from '../pubsub';

async function publishChatUpdated(chat: any, updatedBy: string) {
  try {
    await getPubSub().publish(
      createEvent<ChatUpdatedEvent>(EventType.CHAT_UPDATED, {
        chatId: chat._id.toString(),
        name: chat.title,
        avatar: chat.avatarUrl,
        updatedBy,
      })
    );
  } catch (error) {
    logger.error({ error, chatId: chat._id.toString() }, 'Failed to publish chat updated event');
  }
}

async function publishMemberAdded(chat: any, userId: string, addedBy: string) {
  try {
    await getPubSub().publish(
      createEvent<ChatMemberAddedEvent>(EventType.CHAT_MEMBER_ADDED, {
        chatId: chat._id.toString(),
        userId,
        addedBy,
      })
    );
  } catch (error) {
    logger.error({ error, chatId: chat._id.toString(), userId }, 'Failed to publish chat member added event');
  }
}

async function publishMemberRemoved(chat: any, userId: string, removedBy: string) {
  try {
    await getPubSub().publish(
      createEvent<ChatMemberRemovedEvent>(EventType.CHAT_MEMBER_REMOVED, {
        chatId: chat._id.toString(),
        userId,
        removedBy,
      })
    );
  } catch (error) {
    logger.error({ error, chatId: chat._id.toString(), userId }, 'Failed to publish chat member removed event');
  }
}

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
  if (isChatExpired(chat)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Ended or deleted groups cannot add members',
    });
  }
  const userExists = await getDatabase().collection('users').findOne({ _id: newMemberId });
  if (!userExists) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Selected user does not exist',
    });
  }

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

  const serializedChat = await serializeChat(updatedChat, { includeParticipants: true });
  await publishMemberAdded(updatedChat, userId, (req as any).user?.userId || 'system');
  await publishChatUpdated(updatedChat, (req as any).user?.userId || 'system');

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
  const ownerId = chat.ownerId || chat.admins[0];
  if (ownerId?.equals(memberToRemoveId)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'The group owner cannot be removed',
    });
  }

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

  const serializedChat = await serializeChat(updatedChat, { includeParticipants: true });
  await publishMemberRemoved(updatedChat, userId, (req as any).user?.userId || 'system');
  await publishChatUpdated(updatedChat, (req as any).user?.userId || 'system');

  return res.status(200).json({
    chat: serializedChat,
  });
});

export const promoteMember = asyncHandler(async (req: Request, res: Response) => {
  const validationResult = UpdateGroupRoleDTOSchema.safeParse(req.body);
  if (!validationResult.success || !ObjectId.isValid(validationResult.data.userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid user ID',
      details: validationResult.success ? undefined : validationResult.error.errors,
    });
  }

  const chat = (req as any).chat;
  const memberId = new ObjectId(validationResult.data.userId);
  if (!chat.participants.some((participantId: ObjectId) => participantId.equals(memberId))) {
    return res.status(400).json({ error: 'Bad Request', message: 'User is not a member of this chat' });
  }

  await getChatsCollection().updateOne(
    { _id: chat._id },
    { $addToSet: { admins: memberId }, $set: { updatedAt: new Date() } }
  );
  const updatedChat = await getChatsCollection().findOne({ _id: chat._id });
  await publishChatUpdated(updatedChat!, (req as any).user?.userId || 'system');
  return res.status(200).json({ chat: await serializeChat(updatedChat!, { includeParticipants: true }) });
});

export const demoteMember = asyncHandler(async (req: Request, res: Response) => {
  const validationResult = UpdateGroupRoleDTOSchema.safeParse(req.body);
  if (!validationResult.success || !ObjectId.isValid(validationResult.data.userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid user ID',
      details: validationResult.success ? undefined : validationResult.error.errors,
    });
  }

  const chat = (req as any).chat;
  const ownerId = chat.ownerId || chat.admins[0];
  const memberId = new ObjectId(validationResult.data.userId);
  if (ownerId?.equals(memberId)) {
    return res.status(400).json({ error: 'Bad Request', message: 'The group owner cannot be demoted' });
  }
  if (chat.admins.length <= 1 && chat.admins.some((adminId: ObjectId) => adminId.equals(memberId))) {
    return res.status(400).json({ error: 'Bad Request', message: 'Cannot remove the last admin from the group' });
  }

  await getChatsCollection().updateOne(
    { _id: chat._id },
    { $pull: { admins: memberId }, $set: { updatedAt: new Date() } }
  );
  const updatedChat = await getChatsCollection().findOne({ _id: chat._id });
  await publishChatUpdated(updatedChat!, (req as any).user?.userId || 'system');
  return res.status(200).json({ chat: await serializeChat(updatedChat!, { includeParticipants: true }) });
});

export const transferOwnership = asyncHandler(async (req: Request, res: Response) => {
  const validationResult = UpdateGroupRoleDTOSchema.safeParse(req.body);
  if (!validationResult.success || !ObjectId.isValid(validationResult.data.userId)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid user ID',
      details: validationResult.success ? undefined : validationResult.error.errors,
    });
  }

  const userId = (req as any).user?.userId;
  const chat = (req as any).chat;
  if (!userId || !chat) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const currentOwnerId = chat.ownerId || chat.admins[0];
  if (!currentOwnerId?.equals(new ObjectId(userId))) {
    return res.status(403).json({ error: 'Forbidden', message: 'Only the group owner can transfer ownership' });
  }

  const nextOwnerId = new ObjectId(validationResult.data.userId);
  if (!chat.participants.some((participantId: ObjectId) => participantId.equals(nextOwnerId))) {
    return res.status(400).json({ error: 'Bad Request', message: 'New owner must be a group member' });
  }

  if (isChatExpired(chat)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Ended or deleted groups cannot transfer ownership' });
  }

  await getChatsCollection().updateOne(
    { _id: chat._id },
    {
      $set: { ownerId: nextOwnerId, updatedAt: new Date() },
      $addToSet: { admins: nextOwnerId },
    }
  );

  const updatedChat = await getChatsCollection().findOne({ _id: chat._id });
  await publishChatUpdated(updatedChat!, userId);
  return res.status(200).json({ chat: await serializeChat(updatedChat!, { includeParticipants: true }) });
});

export const leaveGroup = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const chat = (req as any).chat;
  if (!userId || !chat) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const userObjectId = new ObjectId(userId);
  const ownerId = chat.ownerId || chat.admins[0];
  if (ownerId?.equals(userObjectId)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'The owner must promote another owner before leaving this group',
    });
  }

  await getChatsCollection().updateOne(
    { _id: chat._id },
    {
      $pull: { participants: userObjectId, admins: userObjectId },
      $set: { updatedAt: new Date() },
    }
  );
  await publishMemberRemoved(chat, userId, userId);
  await publishChatUpdated(chat, userId);
  return res.status(200).json({ success: true });
});

export const deleteGroup = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const chat = (req as any).chat;
  if (!userId || !chat) {
    return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  }

  const ownerId = chat.ownerId || chat.admins[0];
  if (!ownerId?.equals(new ObjectId(userId))) {
    return res.status(403).json({ error: 'Forbidden', message: 'Only the group owner can delete this group' });
  }

  const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation.trim() : '';
  if (confirmation !== chat.title) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Type the group name exactly to delete it for everyone',
    });
  }

  const deletedAt = new Date();
  await getChatsCollection().updateOne(
    { _id: chat._id },
    { $set: { deletedAt, updatedAt: deletedAt } }
  );
  await publishChatUpdated(chat, userId);
  return res.status(200).json({ success: true, chatId: chat._id.toString(), deletedAt });
});
