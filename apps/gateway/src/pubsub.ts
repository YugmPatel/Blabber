import { Server as SocketIOServer } from 'socket.io';
import { RedisPubSub } from '@repo/utils';
import { loadRedisConfig } from '@repo/config';
import { logger } from '@repo/utils';
import {
  AppEvent,
  EventType,
  MessageSentEvent,
  MessageEditedEvent,
  MessageDeletedEvent,
  MessageReactionEvent,
  MessageReadEvent,
  ChatCreatedEvent,
  ChatUpdatedEvent,
  ChatMemberAddedEvent,
  ChatMemberRemovedEvent,
  UserOnlineEvent,
  UserOfflineEvent,
  UserTypingEvent,
  UserStopTypingEvent,
} from '@repo/types';

let pubsub: RedisPubSub | null = null;

export function initPubSub(io: SocketIOServer): RedisPubSub {
  if (pubsub) {
    return pubsub;
  }

  const config = loadRedisConfig();

  pubsub = new RedisPubSub({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
  });

  // Subscribe to all events and broadcast via Socket.IO
  setupEventHandlers(pubsub, io);

  logger.info('Initialized Redis Pub/Sub for gateway');

  return pubsub;
}

function setupEventHandlers(pubsub: RedisPubSub, io: SocketIOServer): void {
  // Message events
  pubsub.on(EventType.MESSAGE_SENT, (event: AppEvent) => {
    const eventTyped = event as MessageSentEvent;
    logger.debug({ event: eventTyped.type, chatId: eventTyped.data.chatId }, 'Broadcasting MESSAGE_SENT');
    // Emit to all users in the chat room with proper message format
    // Note: The sender already received the message via message:ack from the socket handler.
    // This broadcast ensures other users in the chat room also receive the message.
    // The frontend deduplicates based on message ID to prevent duplicates for the sender.
    io.to(`chat:${eventTyped.data.chatId}`).emit('message:new', {
      message: eventTyped.data.message ?? {
          _id: eventTyped.data.messageId,
          chatId: eventTyped.data.chatId,
          senderId: eventTyped.data.senderId,
          type: eventTyped.data.mediaType ?? 'text',
          body: eventTyped.data.content,
          media: eventTyped.data.mediaUrl
            ? {
                type: eventTyped.data.mediaType ?? 'image',
                url: eventTyped.data.mediaUrl,
              }
            : undefined,
          replyTo: eventTyped.data.replyTo,
          reactions: [],
          status: 'sent',
          deletedFor: [],
          createdAt: eventTyped.data.createdAt,
        },
    });
  });

  pubsub.on(EventType.MESSAGE_EDITED, (event: AppEvent) => {
    const e = event as MessageEditedEvent;
    logger.debug(
      { event: e.type, messageId: e.data.messageId },
      'Broadcasting MESSAGE_EDITED'
    );
    io.to(`chat:${e.data.chatId}`).emit('message:edit', {
      message: e.data.message ?? {
        _id: e.data.messageId,
        chatId: e.data.chatId,
        body: e.data.content,
        editedAt: e.data.editedAt,
      },
    });
  });

  pubsub.on(EventType.MESSAGE_DELETED, (event: AppEvent) => {
    const e = event as MessageDeletedEvent;
    logger.debug(
      { event: e.type, messageId: e.data.messageId },
      'Broadcasting MESSAGE_DELETED'
    );
    io.to(`chat:${e.data.chatId}`).emit('message:deleted', {
      messageId: e.data.messageId,
      chatId: e.data.chatId,
      deletedBy: e.data.deletedBy,
    });
  });

  pubsub.on(EventType.MESSAGE_REACTION, (event: AppEvent) => {
    const e = event as MessageReactionEvent;
    logger.debug(
      { event: e.type, messageId: e.data.messageId },
      'Broadcasting MESSAGE_REACTION'
    );
    io.to(`chat:${e.data.chatId}`).emit('message:reaction', {
      messageId: e.data.messageId,
      chatId: e.data.chatId,
      userId: e.data.userId,
      emoji: e.data.emoji,
    });
  });

  pubsub.on(EventType.MESSAGE_READ, (event: AppEvent) => {
    const e = event as MessageReadEvent;
    logger.debug({ event: e.type, chatId: e.data.chatId }, 'Broadcasting MESSAGE_READ');
    io.to(`chat:${e.data.chatId}`).emit('message:read', {
      chatId: e.data.chatId,
      userId: e.data.userId,
      messageIds: e.data.messageIds,
    });
  });

  // Chat events
  pubsub.on(EventType.CHAT_CREATED, (event: AppEvent) => {
    const e = event as ChatCreatedEvent;
    logger.debug({ event: e.type, chatId: e.data.chatId }, 'Broadcasting CHAT_CREATED');
    // Emit to all participants
    e.data.participants.forEach((userId) => {
      io.to(`user:${userId}`).emit('chat:created', {
        chatId: e.data.chatId,
        name: e.data.name,
        isGroup: e.data.isGroup,
        participants: e.data.participants,
        createdBy: e.data.createdBy,
      });
    });
  });

  pubsub.on(EventType.CHAT_UPDATED, (event: AppEvent) => {
    const e = event as ChatUpdatedEvent;
    logger.debug({ event: e.type, chatId: e.data.chatId }, 'Broadcasting CHAT_UPDATED');
    io.to(`chat:${e.data.chatId}`).emit('chat:updated', {
      chatId: e.data.chatId,
      name: e.data.name,
      avatar: e.data.avatar,
      updatedBy: e.data.updatedBy,
    });
  });

  pubsub.on(EventType.CHAT_MEMBER_ADDED, (event: AppEvent) => {
    const e = event as ChatMemberAddedEvent;
    logger.debug(
      { event: e.type, chatId: e.data.chatId },
      'Broadcasting CHAT_MEMBER_ADDED'
    );
    io.to(`chat:${e.data.chatId}`).emit('chat:member:added', {
      chatId: e.data.chatId,
      userId: e.data.userId,
      addedBy: e.data.addedBy,
    });
    // Also notify the added user
    io.to(`user:${e.data.userId}`).emit('chat:joined', {
      chatId: e.data.chatId,
    });
  });

  pubsub.on(EventType.CHAT_MEMBER_REMOVED, (event: AppEvent) => {
    const e = event as ChatMemberRemovedEvent;
    logger.debug(
      { event: e.type, chatId: e.data.chatId },
      'Broadcasting CHAT_MEMBER_REMOVED'
    );
    io.to(`chat:${e.data.chatId}`).emit('chat:member:removed', {
      chatId: e.data.chatId,
      userId: e.data.userId,
      removedBy: e.data.removedBy,
    });
    // Also notify the removed user
    io.to(`user:${e.data.userId}`).emit('chat:left', {
      chatId: e.data.chatId,
    });
  });

  // User events
  pubsub.on(EventType.USER_ONLINE, (event: AppEvent) => {
    const e = event as UserOnlineEvent;
    logger.debug({ event: e.type, userId: e.data.userId }, 'Broadcasting USER_ONLINE');
    // Broadcast to all connected clients (they can filter on frontend)
    io.emit('user:online', {
      userId: e.data.userId,
    });
  });

  pubsub.on(EventType.USER_OFFLINE, (event: AppEvent) => {
    const e = event as UserOfflineEvent;
    logger.debug({ event: e.type, userId: e.data.userId }, 'Broadcasting USER_OFFLINE');
    io.emit('user:offline', {
      userId: e.data.userId,
      lastSeen: e.data.lastSeen,
    });
  });

  pubsub.on(EventType.USER_TYPING, (event: AppEvent) => {
    const e = event as UserTypingEvent;
    logger.debug({ event: e.type, userId: e.data.userId }, 'Broadcasting USER_TYPING');
    // Emit to chat room except the typing user
    io.to(`chat:${e.data.chatId}`).emit('user:typing', {
      userId: e.data.userId,
      chatId: e.data.chatId,
    });
  });

  pubsub.on(EventType.USER_STOP_TYPING, (event: AppEvent) => {
    const e = event as UserStopTypingEvent;
    logger.debug({ event: e.type, userId: e.data.userId }, 'Broadcasting USER_STOP_TYPING');
    io.to(`chat:${e.data.chatId}`).emit('user:stop_typing', {
      userId: e.data.userId,
      chatId: e.data.chatId,
    });
  });
}

export function getPubSub(): RedisPubSub {
  if (!pubsub) {
    throw new Error('PubSub not initialized. Call initPubSub() first.');
  }
  return pubsub;
}

export async function closePubSub(): Promise<void> {
  if (pubsub) {
    await pubsub.close();
    pubsub = null;
  }
}
