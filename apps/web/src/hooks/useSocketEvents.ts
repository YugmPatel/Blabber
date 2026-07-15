import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '../types/react-query';
import type { Socket } from 'socket.io-client';
import type { Message, Chat } from '@repo/types';
import type { ServerToClientEvents, ClientToServerEvents } from '@repo/types';
import { useAppStore } from '@/store/app-store';
import { useAuth } from '@/contexts/AuthContext';
import { invalidateSharedContentForChat, messageKeys } from './useMessages';
import { chatKeys } from './useChats';
import { userKeys } from './useUsers';
import { chatActionKeys, upsertOrRemoveAction } from './useChatActions';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

function hydrateMessage(rawMessage: any): Message {
  return {
    ...rawMessage,
    createdAt: new Date(rawMessage.createdAt),
    editedAt: rawMessage.editedAt ? new Date(rawMessage.editedAt) : undefined,
    reactions: (rawMessage.reactions ?? []).map((reaction: any) => ({
      ...reaction,
      createdAt: reaction.createdAt ? new Date(reaction.createdAt) : new Date(),
    })),
  };
}

function messageMatchesCorrelation(message: Message, serverMessage: Message, tempId?: string) {
  return (
    message._id === serverMessage._id ||
    (serverMessage.clientMessageId && message.clientMessageId === serverMessage.clientMessageId) ||
    (serverMessage.clientMessageId && message._id === serverMessage.clientMessageId) ||
    (tempId && (message._id === tempId || message.clientMessageId === tempId))
  );
}

function upsertMessageInData(
  old: InfiniteData<MessagesResponse> | undefined,
  message: Message,
  tempId?: string
) {
  if (!old) return old;

  let found = false;
  const pages = old.pages.map((page) => {
    const messages = page.messages.map((existing) => {
      if (messageMatchesCorrelation(existing, message, tempId)) {
        found = true;
        return message;
      }
      return existing;
    });

    return { ...page, messages };
  });

  if (found) {
    return { ...old, pages };
  }

  return {
    ...old,
    pages: pages.map((page, index) =>
      index === 0 ? { ...page, messages: [message, ...page.messages] } : page
    ),
  };
}

function markMessageFailedInData(
  old: InfiniteData<MessagesResponse> | undefined,
  tempId: string
): InfiniteData<MessagesResponse> | undefined {
  if (!old) return old;

  let found = false;
  const pages = old.pages.map((page) => ({
    ...page,
    messages: page.messages.map((existing) => {
      if (existing._id === tempId || existing.clientMessageId === tempId) {
        found = true;
        return { ...existing, status: 'failed' as const };
      }
      return existing;
    }),
  }));

  return found ? { ...old, pages } : old;
}

function mediaPreviewText(message: Message) {
  if (message.media?.type === 'image') return 'Sent an image';
  if (message.media?.type === 'video') return 'Sent a video';
  if (message.media?.type === 'audio') return 'Sent a voice message';
  if (message.media?.type === 'document') return 'Sent a document';
  if (message.type === 'poll') return 'Sent a poll';
  if (message.type === 'sticker') return 'Sent a sticker';
  if (message.type === 'event') return 'Shared an event';
  return 'Sent a message';
}

function sortChatsByUpdatedAt(a: Chat, b: Chat) {
  const aTime = new Date(a.updatedAt || a.lastMessageRef?.createdAt || 0).getTime();
  const bTime = new Date(b.updatedAt || b.lastMessageRef?.createdAt || 0).getTime();
  return bTime - aTime;
}

// Track processed message IDs to prevent duplicates from multiple sources
const processedMessageIds = new Set<string>();

/**
 * Hook to subscribe to socket events and update React Query cache and Zustand store
 * This hook should be used once at the app level (e.g., in SocketProvider or App component)
 */
export const useSocketEvents = (socket: TypedSocket | null) => {
  const queryClient = useQueryClient();
  const { resolvePendingMessage, setTyping, activeChat } = useAppStore();
  const { user } = useAuth();

  useEffect(() => {
    if (!socket) return;

    // Handler for new messages
    const handleMessageNew = (data: { message: any; tempId?: string }) => {
      // Handle case where message might be undefined or data structure is different
      if (!data || !data.message) {
        console.warn('Received message:new event with invalid data:', data);
        return;
      }

      const messageId = data.message._id;
      const wasAlreadyProcessed = processedMessageIds.has(messageId);

      processedMessageIds.add(messageId);

      // Clean up old entries to prevent memory leak (keep last 100)
      if (processedMessageIds.size > 100) {
        const idsArray = Array.from(processedMessageIds);
        idsArray.slice(0, 50).forEach((id) => processedMessageIds.delete(id));
      }

      const message = hydrateMessage(data.message);
      if (message.planThis?.planId) {
        queryClient.invalidateQueries({ queryKey: ['plan-this-plan', message.planThis.planId] });
        queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() });
      }
      const isOwnMessage = message.senderId === user?._id;
      const isActiveVisibleChat =
        activeChat === message.chatId &&
        document.visibilityState === 'visible' &&
        document.hasFocus();

      // Update React Query cache for messages
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(message.chatId),
        (old) => upsertMessageInData(old, message, data.tempId || message.clientMessageId)
      );

      // Resolve optimistic update if tempId is provided
      if (data.tempId || message.clientMessageId) {
        resolvePendingMessage(data.tempId || message.clientMessageId!, message._id);
      }

      // Update all loaded chat-list caches immediately, including inactive chats.
      const chatListQueries = queryClient.getQueryCache().findAll({ queryKey: chatKeys.lists() });
      chatListQueries.forEach((query) => {
        queryClient.setQueryData<Chat[]>(query.queryKey, (old) => {
          if (!old) return old;

          const updated = old.map((chat) => {
            if (chat._id !== message.chatId) return chat;

            const shouldIncrementUnread =
              !wasAlreadyProcessed && !isOwnMessage && !isActiveVisibleChat;
            const shouldIncrementMention =
              shouldIncrementUnread &&
              chat.type === 'group' &&
              (message.mentions || []).some((mention) => mention.userId === user?._id);

            return {
              ...chat,
              lastMessageRef: {
                messageId: message._id,
                body: message.body || mediaPreviewText(message),
                senderId: message.senderId,
                createdAt: message.createdAt,
              },
              updatedAt: message.createdAt,
              unreadCount: shouldIncrementUnread
                ? (chat.unreadCount || 0) + 1
                : isActiveVisibleChat
                  ? 0
                  : chat.unreadCount || 0,
              mentionUnreadCount: shouldIncrementMention
                ? (chat.mentionUnreadCount || 0) + 1
                : isActiveVisibleChat
                  ? 0
                  : chat.mentionUnreadCount || 0,
            };
          });

          return [...updated].sort(sortChatsByUpdatedAt);
        });
      });

      if (!isActiveVisibleChat) {
        queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      }
      invalidateSharedContentForChat(queryClient, message.chatId);
    };

    // Handler for message edits
    const handleMessageEdit = (data: { message: any }) => {
      const message = hydrateMessage(data.message);
      if (message.planThis?.planId) {
        queryClient.invalidateQueries({ queryKey: ['plan-this-plan', message.planThis.planId] });
        queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() });
      }

      // Update the message in the cache
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(message.chatId),
        (old) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.map((msg) => (msg._id === message._id ? message : msg)),
            })),
          };
        }
      );
      invalidateSharedContentForChat(queryClient, message.chatId);
    };

    const handleMessageReaction = (data: {
      messageId: string;
      chatId: string;
      userId: string;
      emoji: string;
      operation?: 'set' | 'remove';
      reactions?: any[];
      message?: any;
    }) => {
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(data.chatId),
        (old) => {
          if (!old) return old;

          const finalMessage = data.message ? hydrateMessage(data.message) : null;
          const finalReactions = data.reactions?.map((reaction) => ({
            ...reaction,
            createdAt: reaction.createdAt ? new Date(reaction.createdAt) : new Date(),
          }));

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.map((message) => {
                if (message._id !== data.messageId) return message;
                if (finalMessage) return finalMessage;
                if (finalReactions) return { ...message, reactions: finalReactions };

                const reactions = message.reactions.filter(
                  (reaction) => reaction.userId !== data.userId
                );
                if (data.operation !== 'remove') {
                  reactions.push({ userId: data.userId, emoji: data.emoji, createdAt: new Date() });
                }
                return { ...message, reactions };
              }),
            })),
          };
        }
      );
    };

    // Handler for message deletions
    const handleMessageDelete = (data: { messageId: string; chatId: string }) => {
      // Remove the message from the cache
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(data.chatId),
        (old) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.filter((msg) => msg._id !== data.messageId),
            })),
          };
        }
      );

      // Update chat list
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
      invalidateSharedContentForChat(queryClient, data.chatId);
    };

    // Handler for delivery receipts
    const handleReceiptDelivered = (data: { messageId: string; userId: string }) => {
      // Find which chat this message belongs to by checking all message caches
      const queryCache = queryClient.getQueryCache();
      const messageQueries = queryCache.findAll({ queryKey: messageKeys.all });

      messageQueries.forEach((query) => {
        const queryData = query.state.data as InfiniteData<MessagesResponse> | undefined;
        if (!queryData) return;

        // Check if this query contains the message
        const hasMessage = queryData.pages.some((page) =>
          page.messages.some((msg) => msg._id === data.messageId)
        );

        if (hasMessage) {
          queryClient.setQueryData<InfiniteData<MessagesResponse>>(query.queryKey, (old) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                messages: page.messages.map((msg) =>
                  msg._id === data.messageId && msg.status === 'sent'
                    ? { ...msg, status: 'delivered' as const }
                    : msg
                ),
              })),
            };
          });
        }
      });
    };

    // Handler for read receipts
    const handleReceiptRead = (data: { chatId?: string; messageIds: string[]; userId: string }) => {
      // Find which chat these messages belong to by checking all message caches
      const queryCache = queryClient.getQueryCache();
      const messageQueries = queryCache.findAll({ queryKey: messageKeys.all });

      messageQueries.forEach((query) => {
        const queryData = query.state.data as InfiniteData<MessagesResponse> | undefined;
        if (!queryData) return;

        // Check if this query contains any of the messages
        const hasMessages = queryData.pages.some((page) =>
          page.messages.some((msg) => data.messageIds.includes(msg._id))
        );

        if (hasMessages) {
          queryClient.setQueryData<InfiniteData<MessagesResponse>>(query.queryKey, (old) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                messages: page.messages.map((msg) =>
                  data.messageIds.includes(msg._id) ? { ...msg, status: 'read' as const } : msg
                ),
              })),
            };
          });
        }
      });

      if (data.userId === user?._id && data.chatId) {
        queryClient.getQueryCache().findAll({ queryKey: chatKeys.lists() }).forEach((query) => {
          queryClient.setQueryData<Chat[]>(query.queryKey, (old) => {
            if (!old) return old;
            return old.map((chat) =>
              chat._id === data.chatId ? { ...chat, unreadCount: 0, mentionUnreadCount: 0 } : chat
            );
          });
        });
      }
    };

    // Handler for typing indicators
    const handleTypingUpdate = (data: { chatId: string; userId: string; isTyping: boolean }) => {
      setTyping(data.chatId, data.userId, data.isTyping);
    };

    // Handler for chat updates
    const handleChatUpdated = (data: { chat: any }) => {
      const chat: Chat = {
        ...data.chat,
        createdAt: new Date(data.chat.createdAt),
        updatedAt: new Date(data.chat.updatedAt),
        lastMessageRef: data.chat.lastMessageRef
          ? {
              ...data.chat.lastMessageRef,
              createdAt: new Date(data.chat.lastMessageRef.createdAt),
            }
          : undefined,
      };

      // Update the chat detail cache
      queryClient.setQueryData(chatKeys.detail(chat._id), chat);

      // Update the chat in the list cache
      queryClient.setQueryData<Chat[]>(chatKeys.lists(), (old) => {
        if (!old) return old;
        return old.map((c) => (c._id === chat._id ? chat : c));
      });

      // Invalidate chat lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    };

    const handleActionCreated = (data: { chatId: string; action: any }) => {
      const isPersonalForAnotherUser =
        data.action?.visibility === 'personal' &&
        data.action?.personalOwnerUserId &&
        data.action.personalOwnerUserId !== user?._id;
      if (isPersonalForAnotherUser) return;
      queryClient.setQueryData<{ actions: any[] }>(chatActionKeys.list(data.chatId), (current) => {
        const actions = current?.actions || [];
        if (actions.some((action) => action.id === data.action.id)) return current;
        return { actions: [data.action, ...actions] };
      });
      const belongsInMine =
        data.action.visibility === 'personal'
          ? data.action.personalOwnerUserId === user?._id
          : data.action.assignedTo?.userId === user?._id || data.action.createdBy?.userId === user?._id;
      queryClient.setQueryData<{ actions: any[] }>(chatActionKeys.mine(), (current) => {
        if (!current) return current;
        if (!belongsInMine && !current.actions.some((action) => action.id === data.action.id)) return current;
        return { actions: upsertOrRemoveAction(current.actions, data.action) };
      });
      queryClient.invalidateQueries({ queryKey: chatActionKeys.list(data.chatId) });
      queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() });
    };

    const handleActionUpdated = (data: { chatId: string; action: any }) => {
      const isPersonalForAnotherUser =
        data.action?.visibility === 'personal' &&
        data.action?.personalOwnerUserId &&
        data.action.personalOwnerUserId !== user?._id;
      if (isPersonalForAnotherUser) return;
      queryClient.setQueryData<{ actions: any[] }>(chatActionKeys.list(data.chatId), (current) => ({
        actions: upsertOrRemoveAction(current?.actions, data.action),
      }));
      const belongsInMine =
        data.action.visibility === 'personal'
          ? data.action.personalOwnerUserId === user?._id
          : data.action.assignedTo?.userId === user?._id || data.action.createdBy?.userId === user?._id;
      queryClient.setQueryData<{ actions: any[] }>(chatActionKeys.mine(), (current) => {
        if (!current) return current;
        if (!belongsInMine && !current.actions.some((action) => action.id === data.action.id)) return current;
        return { actions: upsertOrRemoveAction(current.actions, data.action) };
      });
      queryClient.invalidateQueries({ queryKey: chatActionKeys.list(data.chatId) });
      queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() });
    };

    // Handler for presence updates
    const handlePresenceUpdate = (data: { userId: string; online: boolean; lastSeen: Date | string | null }) => {
      // Update presence cache
      queryClient.setQueryData(userKeys.presence(data.userId), {
        online: data.online,
        lastSeen: data.lastSeen ? new Date(data.lastSeen) : null,
      });
    };

    // Handler for message acknowledgment (sent back to sender)
    const handleMessageAck = (data: { tempId?: string; clientMessageId?: string; messageId: string; message: any }) => {
      if ((!data.tempId && !data.clientMessageId) || !data.message) {
        return;
      }

      // Mark this message as processed to prevent duplicate from pubsub
      processedMessageIds.add(data.messageId);

      const message = hydrateMessage(data.message);

      // Replace the optimistic message with the real one
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(message.chatId),
        (old) => upsertMessageInData(old, message, data.tempId || data.clientMessageId || message.clientMessageId)
      );

      // Resolve the pending message
      resolvePendingMessage(data.tempId || data.clientMessageId!, message._id);
    };

    // Handler for a message send that the server rejected or errored on.
    // Marks the optimistic entry as failed in place (rather than removing it
    // or leaving it looking "sent") so it survives a refresh as a visibly
    // failed send instead of silently vanishing.
    const handleMessageFailed = (data: {
      tempId?: string;
      clientMessageId?: string;
      chatId?: string;
      message: string;
      code?: string;
    }) => {
      const correlationId = data.tempId || data.clientMessageId;
      console.error('Message send failed:', data);
      if (!correlationId || !data.chatId) return;

      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(data.chatId), (old) =>
        markMessageFailedInData(old, correlationId)
      );
    };

    // Handler for errors
    const handleError = (data: { message: string; code?: string }) => {
      console.error('Socket error:', data);
      // You can integrate with a toast notification system here
      // For now, just log the error
    };

    const handleGroupCallEnded = (data: { chatId: string }) => {
      queryClient.setQueryData(['chats', data.chatId, 'active-group-call'], null);
      queryClient.invalidateQueries({ queryKey: chatKeys.detail(data.chatId) });
    };

    const handleGroupCallParticipants = (data: {
      chatId: string;
      activeParticipantIds: string[];
    }) => {
      if (data.activeParticipantIds.length === 0) {
        queryClient.setQueryData(['chats', data.chatId, 'active-group-call'], null);
      } else {
        queryClient.invalidateQueries({ queryKey: ['chats', data.chatId, 'active-group-call'] });
      }
    };

    const handleMessagePin = (data: { chatId: string }) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.pins(data.chatId) });
    };

    const handleMessageUnpin = (data: { chatId: string }) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.pins(data.chatId) });
    };

    const handleChatArchiveState = () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    };

    // Register all event listeners
    socket.on('message:ack', handleMessageAck);
    socket.on('message:failed', handleMessageFailed);
    socket.on('message:new', handleMessageNew);
    socket.on('message:edit', handleMessageEdit);
    socket.on('message:deleted', handleMessageDelete);
    socket.on('message:reaction', handleMessageReaction);
    socket.on('receipt:delivered', handleReceiptDelivered);
    socket.on('receipt:read', handleReceiptRead);
    socket.on('message:read', handleReceiptRead);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('chat:updated', handleChatUpdated);
    socket.on('action:created', handleActionCreated);
    socket.on('action:updated', handleActionUpdated);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('group-call:ended', handleGroupCallEnded);
    socket.on('group-call:participants', handleGroupCallParticipants);
    socket.on('message:pin', handleMessagePin);
    socket.on('message:unpin', handleMessageUnpin);
    socket.on('chat:archived', handleChatArchiveState);
    socket.on('chat:unarchived', handleChatArchiveState);
    socket.on('error', handleError);

    // Cleanup: remove all event listeners
    return () => {
      socket.off('message:ack', handleMessageAck);
      socket.off('message:failed', handleMessageFailed);
      socket.off('message:new', handleMessageNew);
      socket.off('message:edit', handleMessageEdit);
      socket.off('message:deleted', handleMessageDelete);
      socket.off('message:reaction', handleMessageReaction);
      socket.off('receipt:delivered', handleReceiptDelivered);
      socket.off('receipt:read', handleReceiptRead);
      socket.off('message:read', handleReceiptRead);
      socket.off('typing:update', handleTypingUpdate);
      socket.off('chat:updated', handleChatUpdated);
      socket.off('action:created', handleActionCreated);
      socket.off('action:updated', handleActionUpdated);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('group-call:ended', handleGroupCallEnded);
      socket.off('group-call:participants', handleGroupCallParticipants);
      socket.off('message:pin', handleMessagePin);
      socket.off('message:unpin', handleMessageUnpin);
      socket.off('chat:archived', handleChatArchiveState);
      socket.off('chat:unarchived', handleChatArchiveState);
      socket.off('error', handleError);
    };
  }, [socket, queryClient, resolvePendingMessage, setTyping, activeChat, user?._id]);
};
