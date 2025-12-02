import { Server as SocketIOServer } from 'socket.io';
import { RedisPubSub } from '@repo/utils';
import { loadRedisConfig } from '@repo/config';
import { logger } from '@repo/utils';
import {
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
  pubsub.on(EventType.MESSAGE_SENT, (event: MessageSentEvent) => {
    logger.debug({ event: event.type, chatId: event.data.chatId }, 'Broadcasting MESSAGE_SENT');
    // Emit to all users in the chat room with proper message format
    // Note: The sender already received the message via message:ack from the socket handler.
    // This broadcast ensures other users in the chat room also receive the message.
    // The frontend deduplicates based on message ID to prevent duplicates for the sender.
    io.to(`chat:${event.data.chatId}`).emit('message:new', {
      message: {
        _id: event.data.messageId,
        chatId: event.data.chatId,
        senderId: event.data.senderId,
        body: event.data.content,
        media: event.data.mediaUrl ? { type: 'image', url: event.data.mediaUrl } : undefined,
        replyTo: event.data.replyTo,
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: event.data.createdAt,
      },
    });
  });

  pubsub.on(EventType.MESSAGE_EDITED, (event: MessageEditedEvent) => {
    logger.debug(
      { event: event.type, messageId: event.data.messageId },
      'Broadcasting MESSAGE_EDITED'
    );
    io.to(`chat:${event.data.chatId}`).emit('message:edited', {
      messageId: event.data.messageId,
      chatId: event.data.chatId,
      content: event.data.content,
      editedAt: event.data.editedAt,
    });
  });

  pubsub.on(EventType.MESSAGE_DELETED, (event: MessageDeletedEvent) => {
    logger.debug(
      { event: event.type, messageId: event.data.messageId },
      'Broadcasting MESSAGE_DELETED'
    );
    io.to(`chat:${event.data.chatId}`).emit('message:deleted', {
      messageId: event.data.messageId,
      chatId: event.data.chatId,
      deletedBy: event.data.deletedBy,
    });
  });

  pubsub.on(EventType.MESSAGE_REACTION, (event: MessageReactionEvent) => {
    logger.debug(
      { event: event.type, messageId: event.data.messageId },
      'Broadcasting MESSAGE_REACTION'
    );
    io.to(`chat:${event.data.chatId}`).emit('message:reaction', {
      messageId: event.data.messageId,
      chatId: event.data.chatId,
      userId: event.data.userId,
      emoji: event.data.emoji,
    });
  });

  pubsub.on(EventType.MESSAGE_READ, (event: MessageReadEvent) => {
    logger.debug({ event: event.type, chatId: event.data.chatId }, 'Broadcasting MESSAGE_READ');
    io.to(`chat:${event.data.chatId}`).emit('message:read', {
      chatId: event.data.chatId,
      userId: event.data.userId,
      messageIds: event.data.messageIds,
    });
  });

  // Chat events
  pubsub.on(EventType.CHAT_CREATED, (event: ChatCreatedEvent) => {
    logger.debug({ event: event.type, chatId: event.data.chatId }, 'Broadcasting CHAT_CREATED');
    // Emit to all participants
    event.data.participants.forEach((userId) => {
      io.to(`user:${userId}`).emit('chat:created', {
        chatId: event.data.chatId,
        name: event.data.name,
        isGroup: event.data.isGroup,
        participants: event.data.participants,
        createdBy: event.data.createdBy,
      });
    });
  });

  pubsub.on(EventType.CHAT_UPDATED, (event: ChatUpdatedEvent) => {
    logger.debug({ event: event.type, chatId: event.data.chatId }, 'Broadcasting CHAT_UPDATED');
    io.to(`chat:${event.data.chatId}`).emit('chat:updated', {
      chatId: event.data.chatId,
      name: event.data.name,
      avatar: event.data.avatar,
      updatedBy: event.data.updatedBy,
    });
  });

  pubsub.on(EventType.CHAT_MEMBER_ADDED, (event: ChatMemberAddedEvent) => {
    logger.debug(
      { event: event.type, chatId: event.data.chatId },
      'Broadcasting CHAT_MEMBER_ADDED'
    );
    io.to(`chat:${event.data.chatId}`).emit('chat:member:added', {
      chatId: event.data.chatId,
      userId: event.data.userId,
      addedBy: event.data.addedBy,
    });
    // Also notify the added user
    io.to(`user:${event.data.userId}`).emit('chat:joined', {
      chatId: event.data.chatId,
    });
  });

  pubsub.on(EventType.CHAT_MEMBER_REMOVED, (event: ChatMemberRemovedEvent) => {
    logger.debug(
      { event: event.type, chatId: event.data.chatId },
      'Broadcasting CHAT_MEMBER_REMOVED'
    );
    io.to(`chat:${event.data.chatId}`).emit('chat:member:removed', {
      chatId: event.data.chatId,
      userId: event.data.userId,
      removedBy: event.data.removedBy,
    });
    // Also notify the removed user
    io.to(`user:${event.data.userId}`).emit('chat:left', {
      chatId: event.data.chatId,
    });
  });

  // User events
  pubsub.on(EventType.USER_ONLINE, (event: UserOnlineEvent) => {
    logger.debug({ event: event.type, userId: event.data.userId }, 'Broadcasting USER_ONLINE');
    // Broadcast to all connected clients (they can filter on frontend)
    io.emit('user:online', {
      userId: event.data.userId,
    });
  });

  pubsub.on(EventType.USER_OFFLINE, (event: UserOfflineEvent) => {
    logger.debug({ event: event.type, userId: event.data.userId }, 'Broadcasting USER_OFFLINE');
    io.emit('user:offline', {
      userId: event.data.userId,
      lastSeen: event.data.lastSeen,
    });
  });

  pubsub.on(EventType.USER_TYPING, (event: UserTypingEvent) => {
    logger.debug({ event: event.type, userId: event.data.userId }, 'Broadcasting USER_TYPING');
    // Emit to chat room except the typing user
    io.to(`chat:${event.data.chatId}`).emit('user:typing', {
      userId: event.data.userId,
      chatId: event.data.chatId,
    });
  });

  pubsub.on(EventType.USER_STOP_TYPING, (event: UserStopTypingEvent) => {
    logger.debug({ event: event.type, userId: event.data.userId }, 'Broadcasting USER_STOP_TYPING');
    io.to(`chat:${event.data.chatId}`).emit('user:stop_typing', {
      userId: event.data.userId,
      chatId: event.data.chatId,
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
