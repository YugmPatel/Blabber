import type { Socket, Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
import { logger } from '@repo/utils';
import { serviceUrls } from '../config.js';
import type {
  CallAnswerPayload,
  CallControlPayload,
  GroupCallDeclinePayload,
  GroupCallLeavePayload,
  GroupCallStartPayload,
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

async function getAuthorizedChat(socket: Socket, chatId: string) {
  const token = socket.data.token;
  const response = await axios.get(`${serviceUrls.chats}/${chatId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data.chat as {
    type: 'direct' | 'group';
    participants: string[];
    title?: string;
    avatarUrl?: string;
    deletedAt?: string;
    endedAt?: string;
  };
}

async function validateCallTarget(socket: Socket, chatId: string, toUserId: string) {
  const fromUserId = socket.data.userId;
  const chat = await getAuthorizedChat(socket, chatId);

  if (!chat.participants.includes(toUserId) || toUserId === fromUserId) {
    throw new Error('Invalid call participant');
  }

  if (chat.type === 'direct') {
    const response = await axios.get(`${serviceUrls.users}/blocks/relationship/${toUserId}`, {
      headers: { Authorization: `Bearer ${socket.data.token}` },
    });
    if (response.data?.blocked) {
      throw new Error('Call unavailable');
    }
  }
}

async function getPublicUserSettings(userId: string) {
  const response = await axios.get(`${serviceUrls.users}/settings/${userId}/public`);
  return response.data.settings as {
    incomingCallsEnabled: boolean;
    presenceVisible: boolean;
    lastSeenVisible: boolean;
  };
}

async function recordCallEvent(
  socket: Socket,
  payload: {
    callId: string;
    chatId: string;
    callType?: 'audio' | 'video';
    targetUserId?: string;
    event: 'invite' | 'accept' | 'decline' | 'cancel' | 'end' | 'group-leave';
  }
) {
  try {
    await axios.post(`${serviceUrls.chats}/calls/events`, payload, {
      headers: { Authorization: `Bearer ${socket.data.token}` },
    });
  } catch (error: any) {
    logger.warn(
      { error: error.response?.data || error.message, callId: payload.callId, event: payload.event },
      'Failed to record call history event'
    );
  }
}

async function recordGroupCallLeave(socket: Socket, payload: { callId: string; chatId: string; clientSessionId?: string }) {
  try {
    const response = await axios.post(
      `${serviceUrls.chats}/calls/events`,
      { ...payload, event: 'group-leave' },
      {
        headers: { Authorization: `Bearer ${socket.data.token}` },
      }
    );
    return response.data as {
      success: boolean;
      ended?: boolean;
      activeParticipantIds?: string[];
    };
  } catch (error: any) {
    logger.warn(
      { error: error.response?.data || error.message, callId: payload.callId },
      'Failed to record group call leave'
    );
    return { success: false, ended: false, activeParticipantIds: [] };
  }
}

async function forwardCallControl(
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

  try {
    await validateCallTarget(socket, data.chatId, data.toUserId);
  } catch (error) {
    emitCallError(socket, data.callId, 'Call participant is not authorized for this chat');
    return;
  }

  io.to(`user:${data.toUserId}`).emit(event, {
    ...data,
    fromUserId,
  });

  const eventName = event.replace('call:', '') as 'accept' | 'decline' | 'cancel' | 'end';
  await recordCallEvent(socket, {
    callId: data.callId,
    chatId: data.chatId,
    targetUserId: data.toUserId,
    event: eventName,
  });
}

async function forwardCallSignal<T extends CallOfferPayload | CallAnswerPayload | CallIceCandidatePayload>(
  socket: Socket,
  io: SocketIOServer,
  event: 'call:offer' | 'call:answer' | 'call:ice-candidate',
  data: T
) {
  const fromUserId = socket.data.userId;
  if (!data?.callId || !data?.chatId || !data?.toUserId || !fromUserId) {
    emitCallError(socket, data?.callId, 'Invalid call signal payload');
    return;
  }

  try {
    await validateCallTarget(socket, data.chatId, data.toUserId);
  } catch (error) {
    emitCallError(socket, data.callId, 'Call participant is not authorized for this chat');
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

  socket.on(
    'client:activity',
    (data: { activeChatId?: string | null; visible: boolean; focused: boolean }) => {
      socket.data.activity = {
        activeChatId: data.activeChatId ?? null,
        visible: Boolean(data.visible),
        focused: Boolean(data.focused),
        updatedAt: Date.now(),
      };
    }
  );

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
      mentions?: Array<{ userId: string; start: number; length: number }>;
      clientMessageId?: string;
      tempId?: string;
    }) => {
      try {
        const { chatId, body, type, mediaId, mediaDuration, poll, sticker, event, replyToId, mentions, tempId, clientMessageId } = data;
        const userId = socket.data.userId;
        const token = socket.data.token;
        const stableClientMessageId = clientMessageId || tempId;

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
            mentions,
            clientMessageId: stableClientMessageId,
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
          clientMessageId: stableClientMessageId,
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
  socket.on('call:invite', async (data: CallInvitePayload) => {
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

    try {
      await validateCallTarget(socket, data.chatId, data.toUserId);
      const targetSettings = await getPublicUserSettings(data.toUserId);
      if (!targetSettings.incomingCallsEnabled) {
        emitCallError(socket, data.callId, 'User is not accepting calls right now');
        return;
      }
    } catch (error) {
      emitCallError(socket, data.callId, 'Call participant is not authorized for this chat');
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
    await recordCallEvent(socket, {
      callId: data.callId,
      chatId: data.chatId,
      callType: data.callType,
      targetUserId: data.toUserId,
      event: 'invite',
    });
  });

  socket.on('call:accept', async (data: CallControlPayload) => {
    await forwardCallControl(socket, io, 'call:accept', data);
  });

  socket.on('call:decline', async (data: CallControlPayload) => {
    await forwardCallControl(socket, io, 'call:decline', data);
  });

  socket.on('call:cancel', async (data: CallControlPayload) => {
    await forwardCallControl(socket, io, 'call:cancel', data);
  });

  socket.on('call:end', async (data: CallControlPayload) => {
    await forwardCallControl(socket, io, 'call:end', data);
  });

  socket.on('call:offer', async (data: CallOfferPayload) => {
    await forwardCallSignal(socket, io, 'call:offer', data);
  });

  socket.on('call:answer', async (data: CallAnswerPayload) => {
    await forwardCallSignal(socket, io, 'call:answer', data);
  });

  socket.on('call:ice-candidate', async (data: CallIceCandidatePayload) => {
    await forwardCallSignal(socket, io, 'call:ice-candidate', data);
  });

  socket.on('group-call:start', async (data: GroupCallStartPayload) => {
    const fromUserId = socket.data.userId;
    if (!data?.callId || !data?.chatId || !data?.callType || !fromUserId) {
      emitCallError(socket, data?.callId, 'Invalid group call invite');
      return;
    }

    try {
      const chat = await getAuthorizedChat(socket, data.chatId);
      if (chat.type !== 'group' || !chat.participants.includes(fromUserId) || chat.deletedAt || chat.endedAt) {
        emitCallError(socket, data.callId, 'Group call is not authorized for this chat');
        return;
      }

      const startedAt = data.startedAt || new Date().toISOString();
      const eligibleParticipantIds = chat.participants.filter((participantId) => participantId !== fromUserId);
      let deliveredCount = 0;

      for (const participantId of eligibleParticipantIds) {
        try {
          const settings = await getPublicUserSettings(participantId);
          if (!settings.incomingCallsEnabled || !hasUserRoom(io, participantId)) continue;
          io.to(`user:${participantId}`).emit('group-call:incoming', {
            callId: data.callId,
            chatId: data.chatId,
            chatTitle: data.chatTitle || chat.title,
            chatAvatarUrl: data.chatAvatarUrl || chat.avatarUrl,
            fromUserId,
            fromUserName: data.fromUserName,
            callType: data.callType,
            startedAt,
          });
          deliveredCount += 1;
        } catch (error) {
          logger.warn({ error, participantId, chatId: data.chatId }, 'Failed to deliver group call invite');
        }
      }

      await recordCallEvent(socket, {
        callId: data.callId,
        chatId: data.chatId,
        callType: data.callType,
        event: 'invite',
      });

      socket.emit('group-call:started', {
        callId: data.callId,
        chatId: data.chatId,
        deliveredCount,
        startedAt,
      });
    } catch (error) {
      emitCallError(socket, data.callId, 'Group call is not authorized for this chat');
    }
  });

  socket.on('group-call:decline', async (data: GroupCallDeclinePayload) => {
    const fromUserId = socket.data.userId;
    if (!data?.callId || !data?.chatId || !data?.toUserId || !fromUserId) {
      emitCallError(socket, data?.callId, 'Invalid group call response');
      return;
    }

    try {
      const chat = await getAuthorizedChat(socket, data.chatId);
      if (chat.type !== 'group' || !chat.participants.includes(fromUserId) || !chat.participants.includes(data.toUserId)) {
        emitCallError(socket, data.callId, 'Group call is not authorized for this chat');
        return;
      }
      io.to(`user:${data.toUserId}`).emit('group-call:decline', {
        ...data,
        fromUserId,
      });
      await recordCallEvent(socket, {
        callId: data.callId,
        chatId: data.chatId,
        targetUserId: fromUserId,
        event: 'decline',
      });
    } catch (error) {
      emitCallError(socket, data.callId, 'Group call is not authorized for this chat');
    }
  });

  socket.on('group-call:leave', async (data: GroupCallLeavePayload) => {
    const fromUserId = socket.data.userId;
    if (!data?.callId || !data?.chatId || !fromUserId) {
      emitCallError(socket, data?.callId, 'Invalid group call leave');
      return;
    }

    try {
      const chat = await getAuthorizedChat(socket, data.chatId);
      if (chat.type !== 'group' || !chat.participants.includes(fromUserId)) {
        emitCallError(socket, data.callId, 'Group call is not authorized for this chat');
        return;
      }

      const result = await recordGroupCallLeave(socket, {
        callId: data.callId,
        chatId: data.chatId,
        clientSessionId: data.clientSessionId,
      });

      const activeParticipantIds = result.activeParticipantIds || [];
      for (const participantId of chat.participants) {
        io.to(`user:${participantId}`).emit('group-call:participants', {
          callId: data.callId,
          chatId: data.chatId,
          activeParticipantIds,
        });
      }

      if (result.ended) {
        const endedAt = new Date().toISOString();
        for (const participantId of chat.participants) {
          io.to(`user:${participantId}`).emit('group-call:ended', {
            callId: data.callId,
            chatId: data.chatId,
            endedAt,
          });
        }
      }
    } catch (error) {
      emitCallError(socket, data.callId, 'Group call is not authorized for this chat');
    }
  });

  // message:read - Mark messages as read
  socket.on('message:read', async (data: { messageIds: string[] }) => {
    try {
      const { messageIds } = data;
      const userId = socket.data.userId;
      const token = socket.data.token;

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        socket.emit('error', { message: 'messageIds array is required' });
        return;
      }

      // Call messages service to mark as read (batch)
      await axios.post(
        `${serviceUrls.messages}/read`,
        { messageIds },
        {
          headers: {
            Authorization: `Bearer ${token}`,
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
      const token = socket.data.token;

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
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const message = response.data;

      socket.emit('message:edit', { message });

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
      description?: string;
      groupContext?: string;
      groupKind?: 'standard' | 'temporary';
      expiresAt?: string;
    }) => {
      try {
        const { type, participantIds, title, avatarUrl, description, groupContext, groupKind, expiresAt } = data;
        const userId = socket.data.userId;
        const token = socket.data.token;

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
            description,
            groupContext,
            groupKind,
            expiresAt,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
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
