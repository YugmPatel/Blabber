import type { Socket } from 'socket.io';
import { logger } from '@repo/utils';

export function setupRoomManagement(socket: Socket) {
  // Handle chat:join event
  socket.on('chat:join', (data: { chatId: string }) => {
    const { chatId } = data;

    if (!chatId) {
      socket.emit('error', { message: 'chatId is required' });
      return;
    }

    const chatRoom = `chat:${chatId}`;
    socket.join(chatRoom);

    logger.info(`Socket ${socket.id} joined room ${chatRoom}`);

    // Acknowledge the join
    socket.emit('chat:joined', { chatId });
  });

  // Handle chat:leave event
  socket.on('chat:leave', (data: { chatId: string }) => {
    const { chatId } = data;

    if (!chatId) {
      socket.emit('error', { message: 'chatId is required' });
      return;
    }

    const chatRoom = `chat:${chatId}`;
    socket.leave(chatRoom);

    logger.info(`Socket ${socket.id} left room ${chatRoom}`);

    // Acknowledge the leave
    socket.emit('chat:left', { chatId });
  });
}
