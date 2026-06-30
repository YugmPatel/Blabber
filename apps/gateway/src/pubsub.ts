import { Server as SocketIOServer } from 'socket.io';
import axios from 'axios';
import { RedisPubSub } from '@repo/utils';
import { loadRedisConfig } from '@repo/config';
import { logger } from '@repo/utils';
import { serviceUrls } from './config.js';
import {
  AppEvent,
  EventType,
  MessageSentEvent,
  MessageEditedEvent,
  MessageDeletedEvent,
  MessageReactionEvent,
  MessageReadEvent,
  MomentInteractionsUpdatedEvent,
  MomentReactionUpdatedEvent,
  ProfileUpdatedEvent,
  FollowUpdatedEvent,
  FollowRequestUpdatedEvent,
  PostEvent,
  ReelEvent,
  CommunityEvent,
  ChatCreatedEvent,
  ChatUpdatedEvent,
  ChatMemberAddedEvent,
  ChatMemberRemovedEvent,
  ChatArchiveEvent,
  MessagePinEvent,
  UserOnlineEvent,
  UserOfflineEvent,
  UserTypingEvent,
  UserStopTypingEvent,
  ActionCreatedEvent,
  ActionUpdatedEvent,
} from '@repo/types';

let pubsub: RedisPubSub | null = null;

function isRecipientActivelyViewingChat(io: SocketIOServer, userId: string, chatId: string): boolean {
  const socketIds = io.sockets.adapter.rooms.get(`user:${userId}`);
  if (!socketIds) return false;

  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    const activity = socket?.data.activity as
      | { activeChatId?: string | null; visible?: boolean; focused?: boolean }
      | undefined;

    if (activity?.visible && activity?.focused && activity.activeChatId === chatId) {
      return true;
    }
  }

  return false;
}

function buildMessagePreview(event: MessageSentEvent) {
  const senderName = event.data.senderName || 'Someone';
  const mediaType = event.data.mediaType || event.data.message?.media?.type;
  const text = (event.data.content || event.data.message?.body || '').trim();

  if (mediaType === 'image') return `${senderName} sent an image`;
  if (mediaType === 'audio') return `${senderName} sent a voice message`;
  if (mediaType === 'document') return `${senderName} sent a document`;
  if (text) return `${senderName}: ${text.slice(0, 140)}`;
  return `${senderName} sent a message`;
}

function buildNoPreviewBody(event: MessageSentEvent) {
  return `${event.data.senderName || 'Someone'} sent you a new message`;
}

function mentionedUserIds(event: Pick<MessageSentEvent | MessageEditedEvent, 'data'>) {
  return Array.from(new Set((event.data.mentions || []).map((mention: any) => mention.userId).filter(Boolean)));
}

function buildMentionPreview(event: Pick<MessageSentEvent | MessageEditedEvent, 'data'>) {
  const senderName = event.data.senderName || 'Someone';
  const text = (event.data.content || event.data.message?.body || '').trim();
  return text ? `${senderName}: ${text.slice(0, 140)}` : `${senderName} mentioned you.`;
}

async function sendMentionPushes(io: SocketIOServer, event: Pick<MessageSentEvent | MessageEditedEvent, 'data'>): Promise<void> {
  if (event.data.chatType !== 'group') return;
  const groupName = event.data.chatTitle || 'a group';
  const recipients = mentionedUserIds(event)
    .filter((userId) => userId !== event.data.senderId)
    .filter((userId) => (event.data.participants || []).includes(userId));

  await Promise.all(Array.from(new Set(recipients)).map(async (recipientId) => {
    if (isRecipientActivelyViewingChat(io, recipientId, event.data.chatId)) return;
    try {
      await axios.post(`${serviceUrls.notifications}/send`, {
        userId: recipientId,
        kind: 'mention',
        title: `You were mentioned in ${groupName}`,
        body: buildMentionPreview(event),
        data: {
          chatId: event.data.chatId,
          messageId: event.data.messageId,
          senderId: event.data.senderId,
          route: `/chats/${event.data.chatId}?message=${event.data.messageId}`,
          noPreviewBody: `You were mentioned in ${groupName}.`,
        },
      });
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message, recipientId, chatId: event.data.chatId }, 'Failed to send mention push notification');
    }
  }));
}

async function sendMessagePushes(io: SocketIOServer, event: MessageSentEvent): Promise<void> {
  const participants = event.data.participants ?? [];
  if (participants.length === 0) return;

  const senderId = event.data.senderId;
  const mentionRecipients = new Set(mentionedUserIds(event));
  const recipients = participants.filter((participantId) => participantId !== senderId && !mentionRecipients.has(participantId));
  const uniqueRecipients = Array.from(new Set(recipients));

  await Promise.all(
    uniqueRecipients.map(async (recipientId) => {
      if (isRecipientActivelyViewingChat(io, recipientId, event.data.chatId)) {
        return;
      }

      const isGroup = event.data.chatType === 'group';
      const title = isGroup && event.data.chatTitle ? `Blabber · ${event.data.chatTitle}` : 'Blabber';

      try {
        await axios.post(`${serviceUrls.notifications}/send`, {
          userId: recipientId,
          kind: 'message',
          title,
          body: buildMessagePreview(event),
          data: {
            chatId: event.data.chatId,
            messageId: event.data.messageId,
            senderId,
            route: `/chats/${event.data.chatId}`,
            noPreviewBody: buildNoPreviewBody(event),
          },
        });
      } catch (error: any) {
        logger.error(
          {
            error: error.response?.data || error.message,
            recipientId,
            chatId: event.data.chatId,
            messageId: event.data.messageId,
          },
          'Failed to send message push notification'
        );
      }
    })
  );
}

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
    const payload = {
      tempId: eventTyped.data.clientMessageId,
      message: eventTyped.data.message ?? {
        _id: eventTyped.data.messageId,
        chatId: eventTyped.data.chatId,
        senderId: eventTyped.data.senderId,
        clientMessageId: eventTyped.data.clientMessageId,
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
    };

    const participants = Array.from(new Set(eventTyped.data.participants ?? []));
    if (participants.length > 0) {
      participants.forEach((userId) => {
        io.to(`user:${userId}`).emit('message:new', payload);
      });
    } else {
      io.to(`chat:${eventTyped.data.chatId}`).emit('message:new', payload);
    }

    void sendMessagePushes(io, eventTyped);
    void sendMentionPushes(io, eventTyped);
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
    if (e.data.mentions?.length) {
      void sendMentionPushes(io, e);
    }
  });

  pubsub.on(EventType.MESSAGE_PINNED, (event: AppEvent) => {
    const e = event as MessagePinEvent;
    e.data.participants.forEach((userId) => {
      io.to(`user:${userId}`).emit('message:pin', { pin: e.data.pin, chatId: e.data.chatId });
    });
  });

  pubsub.on(EventType.MESSAGE_UNPINNED, (event: AppEvent) => {
    const e = event as MessagePinEvent;
    e.data.participants.forEach((userId) => {
      io.to(`user:${userId}`).emit('message:unpin', { messageId: e.data.messageId, chatId: e.data.chatId });
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
      operation: e.data.operation,
      reactions: e.data.reactions,
      message: e.data.message,
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

  pubsub.on(EventType.MOMENT_REACTION_UPDATED, (event: AppEvent) => {
    const e = event as MomentReactionUpdatedEvent;
    io.to(`user:${e.data.viewerUserId}`).emit('moment:reaction', {
      momentId: e.data.momentId,
      emoji: e.data.emoji,
      operation: e.data.operation,
    });
  });

  pubsub.on(EventType.MOMENT_INTERACTIONS_UPDATED, (event: AppEvent) => {
    const e = event as MomentInteractionsUpdatedEvent;
    io.to(`user:${e.data.authorUserId}`).emit('moment:interactions', {
      momentId: e.data.momentId,
    });
  });

  pubsub.on(EventType.PROFILE_UPDATED, (event: AppEvent) => {
    const e = event as ProfileUpdatedEvent;
    io.to(`user:${e.data.userId}`).emit('profile:updated', { userId: e.data.userId });
  });

  pubsub.on(EventType.FOLLOW_UPDATED, (event: AppEvent) => {
    const e = event as FollowUpdatedEvent;
    Array.from(new Set(e.data.userIds)).forEach((userId) => {
      io.to(`user:${userId}`).emit('follow:updated', {});
    });
  });

  pubsub.on(EventType.FOLLOW_REQUEST_UPDATED, (event: AppEvent) => {
    const e = event as FollowRequestUpdatedEvent;
    Array.from(new Set(e.data.userIds)).forEach((userId) => {
      io.to(`user:${userId}`).emit('follow:request-updated', {});
    });
  });

  const emitPostEvent = (eventName: string, event: AppEvent) => {
    const e = event as PostEvent;
    io.to(`user:${e.data.authorUserId}`).emit(eventName, {
      postId: e.data.postId,
      authorUserId: e.data.authorUserId,
    });
  };

  pubsub.on(EventType.POST_CREATED, (event: AppEvent) => emitPostEvent('feed:updated', event));
  pubsub.on(EventType.POST_UPDATED, (event: AppEvent) => emitPostEvent('post:updated', event));
  pubsub.on(EventType.POST_DELETED, (event: AppEvent) => emitPostEvent('post:deleted', event));
  pubsub.on(EventType.POST_INTERACTION_UPDATED, (event: AppEvent) => emitPostEvent('post:interaction-updated', event));
  pubsub.on(EventType.POST_COMMENTS_UPDATED, (event: AppEvent) => emitPostEvent('post:comments-updated', event));

  const emitReelEvent = (eventName: string, event: AppEvent) => {
    const e = event as ReelEvent;
    Array.from(new Set([e.data.authorUserId, ...(e.data.userIds || [])].filter(Boolean))).forEach((userId) => {
      io.to(`user:${userId}`).emit(eventName, { reelId: e.data.reelId });
    });
  };

  pubsub.on(EventType.REEL_INTERACTION_UPDATED, (event: AppEvent) => emitReelEvent('reel:interaction-updated', event));
  pubsub.on(EventType.REEL_COMMENTS_UPDATED, (event: AppEvent) => emitReelEvent('reel:comments-updated', event));
  pubsub.on(EventType.REEL_DISCOVERABILITY_UPDATED, (event: AppEvent) => emitReelEvent('reel:discoverability-updated', event));

  const emitCommunityEvent = (eventName: string, event: AppEvent) => {
    const e = event as CommunityEvent;
    Array.from(new Set(e.data.userIds || [])).forEach((userId) => {
      io.to(`user:${userId}`).emit(eventName, {
        communityId: e.data.communityId,
        postId: e.data.postId,
      });
    });
  };

  pubsub.on(EventType.COMMUNITY_UPDATED, (event: AppEvent) => emitCommunityEvent('community:updated', event));
  pubsub.on(EventType.COMMUNITY_MEMBERSHIP_UPDATED, (event: AppEvent) => emitCommunityEvent('community:membership-updated', event));
  pubsub.on(EventType.COMMUNITY_JOIN_REQUEST_UPDATED, (event: AppEvent) => emitCommunityEvent('community:join-request-updated', event));
  pubsub.on(EventType.COMMUNITY_MODERATION_UPDATED, (event: AppEvent) => emitCommunityEvent('community:moderation-updated', event));
  pubsub.on(EventType.COMMUNITY_POSTS_UPDATED, (event: AppEvent) => emitCommunityEvent('community:posts-updated', event));
  pubsub.on(EventType.COMMUNITY_POST_INTERACTION_UPDATED, (event: AppEvent) => emitCommunityEvent('community:post-interaction-updated', event));

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

  pubsub.on(EventType.CHAT_ARCHIVED, (event: AppEvent) => {
    const e = event as ChatArchiveEvent;
    io.to(`user:${e.data.userId}`).emit('chat:archived', e.data);
  });

  pubsub.on(EventType.CHAT_UNARCHIVED, (event: AppEvent) => {
    const e = event as ChatArchiveEvent;
    io.to(`user:${e.data.userId}`).emit('chat:unarchived', e.data);
  });

  pubsub.on(EventType.ACTION_CREATED, (event: AppEvent) => {
    const e = event as ActionCreatedEvent;
    logger.debug({ event: e.type, chatId: e.data.chatId }, 'Broadcasting ACTION_CREATED');
    e.data.participants.forEach((userId) => {
      io.to(`user:${userId}`).emit('action:created', {
        chatId: e.data.chatId,
        action: e.data.action,
      });
    });
  });

  pubsub.on(EventType.ACTION_UPDATED, (event: AppEvent) => {
    const e = event as ActionUpdatedEvent;
    logger.debug({ event: e.type, chatId: e.data.chatId }, 'Broadcasting ACTION_UPDATED');
    e.data.participants.forEach((userId) => {
      io.to(`user:${userId}`).emit('action:updated', {
        chatId: e.data.chatId,
        action: e.data.action,
      });
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
