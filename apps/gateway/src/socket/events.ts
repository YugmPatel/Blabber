import type { Socket, Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
import { logger } from '@repo/utils';
import { serviceUrls } from '../config.js';
import type {
  CallAnswerPayload,
  CallControlPayload,
  CallIceCandidatePayload,
  CallInvitePayload,
  CallOfferPayload,
} from '@repo/types';

// Debounce map for typing indicators
const typingDebounceMap = new Map<string, NodeJS.Timeout>();

function emitCallError(socket: Socket, callId: string | undefined, message: string) {
  socket.emit('call:error', { callId, message });
}

function hasUserRoom(io: SocketIOServer, userId: string) {
  return Boolean(io.sockets.adapter.rooms.get(`user:${userId}`)?.size);
}

function forwardCallControl(
  socket: Socket,
  io: SocketIOServer,
  event: 'call:accept' | 'call:decline' | 'call:cancel' | 'call:end',
  data: CallControlPayload
) {
  const fromUserId = socket.data.userId;
  if (!data?.callId || !data?.chatId || !data?.toUserId || !fromUserId) {
    emitCallError(socket, data?.callId, 'Invalid call payload');
    return;
  }

  io.to(`user:${data.toUserId}`).emit(event, {
    ...data,
    fromUserId,
  });
}

function forwardCallSignal<T extends CallOfferPayload | CallAnswerPayload | CallIceCandidatePayload>(
  socket: Socket,
  io: SocketIOServer,
  event: 'call:offer' | 'call:answer' | 'call:ice-candidate',
  data: T
) {
  const fromUserId = socket.data.userId;
  if (!data?.callId || !data?.toUserId || !fromUserId) {
    emitCallError(socket, data?.callId, 'Invalid call signal payload');
    return;
  }

  io.to(`user:${data.toUserId}`).emit(event, {
    ...data,
    fromUserId,
  });
}

export function setupClientEvents(socket: Socket, io: SocketIOServer) {
  // auth:hello - Initial authentication handshake
  socket.on('auth:hello', () => {
    const userId = socket.data.userId;
    logger.info(`auth:hello from user ${userId}`);

    socket.emit('auth:welcome', {
      userId,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // message:send - Send a new message
  socket.on(
    'message:send',
    async (data: {
      chatId: string;
      body: string;
      type?: 'text' | 'poll' | 'sticker' | 'event';
      mediaId?: string;
      mediaDuration?: number;
      poll?: {
        question: string;
        options: string[];
        allowMultiple?: boolean;
      };
      sticker?: {
        emoji: string;
        label?: string;
      };
      event?: {
        title: string;
        startsAt: string;
        location?: string;
        description?: string;
      };
      replyToId?: string;
      tempId?: string;
    }) => {
      try {
        const { chatId, body, type, mediaId, mediaDuration, poll, sticker, event, replyToId, tempId } = data;
        const userId = socket.data.userId;
        const token = socket.data.token;

        if (!chatId || !body) {
          socket.emit('error', { message: 'chatId and body are required' });
          return;
        }

        // Call messages service to create message
        const response = await axios.post(
          `${serviceUrls.messages}/${chatId}`,
          {
            body,
            type,
            mediaId,
            mediaDuration,
            poll,
            sticker,
            event,
            replyToId,
            tempId,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const message = response.data;

        // Send acknowledgment to sender with tempId mapping
        // This allows the sender to replace their optimistic message with the real one
        socket.emit('message:ack', {
          tempId,
          messageId: message._id,
          message,
        });

        // Note: We don't broadcast message:new here because the messages service
        // publishes to Redis, and the pubsub handler broadcasts to all users.
        // The sender will receive the message via pubsub too, but the frontend
        // deduplicates based on message ID.

        logger.info(`Message sent to chat ${chatId} by user ${userId}`);
      } catch (error: any) {
        logger.error('Error sending message:', error);
        socket.emit('error', {
          message: 'Failed to send message',
          details: error.response?.data || error.message,
        });
      }
    }
  );

  // call:* - Minimal one-to-one WebRTC signaling.
  // TODO: Validate chat membership against the chats service before routing calls.
  socket.on('call:invite', (data: CallInvitePayload) => {
    const fromUserId = socket.data.userId;
    if (
      !data?.callId ||
      !data?.chatId ||
      !data?.toUserId ||
      !data?.callType ||
      !fromUserId ||
      data.toUserId === fromUserId
    ) {
      emitCallError(socket, data?.callId, 'Invalid call invite');
      return;
    }

    if (!hasUserRoom(io, data.toUserId)) {
      emitCallError(socket, data.callId, 'User unavailable');
      return;
    }

    io.to(`user:${data.toUserId}`).emit('call:incoming', {
      ...data,
      fromUserId,
    });
  });

  socket.on('call:accept', (data: CallControlPayload) => {
    forwardCallControl(socket, io, 'call:accept', data);
  });

  socket.on('call:decline', (data: CallControlPayload) => {
    forwardCallControl(socket, io, 'call:decline', data);
  });

  socket.on('call:cancel', (data: CallControlPayload) => {
    forwardCallControl(socket, io, 'call:cancel', data);
  });

  socket.on('call:end', (data: CallControlPayload) => {
    forwardCallControl(socket, io, 'call:end', data);
  });

  socket.on('call:offer', (data: CallOfferPayload) => {
    forwardCallSignal(socket, io, 'call:offer', data);
  });

  socket.on('call:answer', (data: CallAnswerPayload) => {
    forwardCallSignal(socket, io, 'call:answer', data);
  });

  socket.on('call:ice-candidate', (data: CallIceCandidatePayload) => {
    forwardCallSignal(socket, io, 'call:ice-candidate', data);
  });

  // message:read - Mark messages as read
  socket.on('message:read', async (data: { messageIds: string[] }) => {
    try {
      const { messageIds } = data;
      const userId = socket.data.userId;

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        socket.emit('error', { message: 'messageIds array is required' });
        return;
      }

      // Call messages service to mark as read (batch)
      await axios.post(
        `${serviceUrls.messages}/${messageIds[0]}/read`,
        { messageIds },
        {
          headers: {
            'x-user-id': userId,
          },
        }
      );

      // Emit read receipts to relevant chat rooms
      // Note: In a real implementation, we'd need to get the chatId from the message
      // For now, we'll emit a generic receipt:read event
      socket.emit('receipt:read', { messageIds, userId });

      logger.info(`Messages marked as read by user ${userId}`);
    } catch (error: any) {
      logger.error('Error marking messages as read:', error);
      socket.emit('error', {
        message: 'Failed to mark messages as read',
        details: error.response?.data || error.message,
      });
    }
  });

  // typing:start - User started typing
  socket.on('typing:start', (data: { chatId: string }) => {
    const { chatId } = data;
    const userId = socket.data.userId;

    if (!chatId) {
      socket.emit('error', { message: 'chatId is required' });
      return;
    }

    // Clear existing debounce timer
    const key = `${userId}:${chatId}`;
    if (typingDebounceMap.has(key)) {
      clearTimeout(typingDebounceMap.get(key)!);
    }

    // Broadcast typing indicator to chat room (except sender)
    socket.to(`chat:${chatId}`).emit('typing:update', {
      chatId,
      userId,
      isTyping: true,
    });

    // Set debounce timer to auto-stop typing after 3 seconds
    const timer = setTimeout(() => {
      socket.to(`chat:${chatId}`).emit('typing:update', {
        chatId,
        userId,
        isTyping: false,
      });
      typingDebounceMap.delete(key);
    }, 3000);

    typingDebounceMap.set(key, timer);

    logger.debug(`User ${userId} started typing in chat ${chatId}`);
  });

  // typing:stop - User stopped typing
  socket.on('typing:stop', (data: { chatId: string }) => {
    const { chatId } = data;
    const userId = socket.data.userId;

    if (!chatId) {
      socket.emit('error', { message: 'chatId is required' });
      return;
    }

    // Clear debounce timer
    const key = `${userId}:${chatId}`;
    if (typingDebounceMap.has(key)) {
      clearTimeout(typingDebounceMap.get(key)!);
      typingDebounceMap.delete(key);
    }

    // Broadcast typing stopped to chat room (except sender)
    socket.to(`chat:${chatId}`).emit('typing:update', {
      chatId,
      userId,
      isTyping: false,
    });

    logger.debug(`User ${userId} stopped typing in chat ${chatId}`);
  });

  // reaction:set - Add/remove reaction
  socket.on('reaction:set', async (data: { messageId: string; emoji: string }) => {
    try {
      const { messageId, emoji } = data;
      const userId = socket.data.userId;

      if (!messageId || !emoji) {
        socket.emit('error', { message: 'messageId and emoji are required' });
        return;
      }

      // Call messages service to set reaction
      const response = await axios.post(
        `${serviceUrls.messages}/${messageId}/react`,
        { emoji },
        {
          headers: {
            'x-user-id': userId,
          },
        }
      );

      const message = response.data.message;

      // Broadcast updated message to chat room
      // Note: We'd need the chatId from the message
      io.emit('message:edit', message);

      logger.info(`Reaction set on message ${messageId} by user ${userId}`);
    } catch (error: any) {
      logger.error('Error setting reaction:', error);
      socket.emit('error', {
        message: 'Failed to set reaction',
        details: error.response?.data || error.message,
      });
    }
  });

  // chat:create - Create new chat
  socket.on(
    'chat:create',
    async (data: {
      type: 'direct' | 'group';
      participantIds: string[];
      title?: string;
      avatarUrl?: string;
    }) => {
      try {
        const { type, participantIds, title, avatarUrl } = data;
        const userId = socket.data.userId;

        if (!type || !participantIds || !Array.isArray(participantIds)) {
          socket.emit('error', { message: 'type and participantIds are required' });
          return;
        }

        // Call chats service to create chat
        const response = await axios.post(
          serviceUrls.chats,
          {
            type,
            participantIds,
            title,
            avatarUrl,
          },
          {
            headers: {
              'x-user-id': userId,
            },
          }
        );

        const chat = response.data.chat;

        // Notify all participants
        participantIds.forEach((participantId) => {
          io.to(`user:${participantId}`).emit('chat:updated', chat);
        });

        // Acknowledge to creator
        socket.emit('chat:created', chat);

        logger.info(`Chat created by user ${userId}`);
      } catch (error: any) {
        logger.error('Error creating chat:', error);
        socket.emit('error', {
          message: 'Failed to create chat',
          details: error.response?.data || error.message,
        });
      }
    }
  );

  // Clean up on disconnect
  socket.on('disconnect', () => {
    const userId = socket.data.userId;

    // Clear all typing timers for this user
    typingDebounceMap.forEach((timer, key) => {
      if (key.startsWith(`${userId}:`)) {
        clearTimeout(timer);
        typingDebounceMap.delete(key);
      }
    });
  });
}
