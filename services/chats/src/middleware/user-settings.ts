import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export async function requireChatIntelligenceEnabled(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
      return;
    }

    const settings = await getDatabase()
      .collection('userSettings')
      .findOne({ userId: new ObjectId(userId) });

    if (settings?.chatIntelligenceEnabled === false) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'AI privacy is disabled in your settings.',
      });
      return;
    }

    const chatId = (req.params.chatId || req.params.id) as string | undefined;
    if (chatId && ObjectId.isValid(chatId)) {
      const chat = await getDatabase()
        .collection('chats')
        .findOne({ _id: new ObjectId(chatId), type: 'group', participants: new ObjectId(userId) });

      if (chat?.aiEnabled === false) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'AI Intelligence is disabled for this group.',
        });
        return;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function getIntelligenceAvailability(_req: Request, res: Response) {
  const configured = Boolean(process.env.OPENROUTER_API_KEY);
  res.status(200).json({
    status: configured ? 'available' : 'not_configured',
  });
}
