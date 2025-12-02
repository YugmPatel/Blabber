import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import { logger } from '@repo/utils';

interface JWTPayload {
  userId: string;
  iat: number;
  exp: number;
}

export function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  const token = socket.handshake.auth.token;

  if (!token) {
    logger.warn(`Socket ${socket.id} authentication failed: No token provided`);
    return next(new Error('Authentication error: No token provided'));
  }

  const jwtSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_ACCESS_SECRET not configured');
    return next(new Error('Server configuration error'));
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

    // Attach user info and token to socket
    socket.data.userId = decoded.userId;
    socket.data.token = token;

    logger.info(`Socket ${socket.id} authenticated for user ${decoded.userId}`);
    next();
  } catch (error) {
    logger.warn(`Socket ${socket.id} authentication failed: Invalid token`, error);
    next(new Error('Authentication error: Invalid token'));
  }
}

export function joinUserRoom(socket: Socket) {
  const userId = socket.data.userId;

  if (!userId) {
    logger.error(`Cannot join user room: userId not found on socket ${socket.id}`);
    return;
  }

  const userRoom = `user:${userId}`;
  socket.join(userRoom);

  logger.info(`Socket ${socket.id} joined room ${userRoom}`);
}
