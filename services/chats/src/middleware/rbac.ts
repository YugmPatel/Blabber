import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getChatsCollection } from '../models/chat';

/**
 * Middleware to verify that the authenticated user is an admin of the chat
 */
export const requireChatAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    // Verify chat is a group chat
    if (chat.type !== 'group') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'This operation is only available for group chats',
      });
    }

    // Verify user is an admin
    const isAdmin = chat.admins.some((adminId) => adminId.equals(userObjectId));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only group admins can perform this action',
      });
    }

    // Attach chat to request for use in route handler
    (req as any).chat = chat;

    next();
  } catch (error) {
    next(error);
  }
};
