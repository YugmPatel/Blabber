import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '../types/react-query';
import type { Socket } from 'socket.io-client';
import type { Message, Chat } from '@repo/types';
import type { ServerToClientEvents, ClientToServerEvents } from '@repo/types';
import { useAppStore } from '@/store/app-store';
import { messageKeys } from './useMessages';
import { chatKeys } from './useChats';
import { userKeys } from './useUsers';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

// Track processed message IDs to prevent duplicates from multiple sources
const processedMessageIds = new Set<string>();

/**
 * Hook to subscribe to socket events and update React Query cache and Zustand store
 * This hook should be used once at the app level (e.g., in SocketProvider or App component)
 */
export const useSocketEvents = (socket: TypedSocket | null) => {
  const queryClient = useQueryClient();
  const { resolvePendingMessage, setTyping } = useAppStore();

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

      // Skip if we've already processed this message (prevents duplicates from pubsub + ack)
      if (processedMessageIds.has(messageId)) {
        return;
      }
      processedMessageIds.add(messageId);

      // Clean up old entries to prevent memory leak (keep last 100)
      if (processedMessageIds.size > 100) {
        const idsArray = Array.from(processedMessageIds);
        idsArray.slice(0, 50).forEach((id) => processedMessageIds.delete(id));
      }

      const message: Message = {
        ...data.message,
        createdAt: new Date(data.message.createdAt),
        editedAt: data.message.editedAt ? new Date(data.message.editedAt) : undefined,
      };

      // Update React Query cache for messages
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(message.chatId),
        (old) => {
          if (!old) return old;

          // Check if message already exists in cache (by _id or tempId)
          const messageExists = old.pages.some((page) =>
            page.messages.some(
              (msg) => msg._id === message._id || (data.tempId && msg._id === data.tempId)
            )
          );

          if (messageExists) {
            // Update existing message (replace temp message with real one)
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                messages: page.messages.map((msg) =>
                  msg._id === message._id || (data.tempId && msg._id === data.tempId)
                    ? message
                    : msg
                ),
              })),
            };
          }

          // Add new message to the first page
          return {
            ...old,
            pages: old.pages.map((page, index) =>
              index === 0
                ? {
                    ...page,
                    messages: [message, ...page.messages],
                  }
                : page
            ),
          };
        }
      );

      // Resolve optimistic update if tempId is provided
      if (data.tempId) {
        resolvePendingMessage(data.tempId, message._id);
      }

      // Update chat list (lastMessage)
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    };

    // Handler for message edits
    const handleMessageEdit = (data: { message: any }) => {
      const message: Message = {
        ...data.message,
        createdAt: new Date(data.message.createdAt),
        editedAt: data.message.editedAt ? new Date(data.message.editedAt) : undefined,
      };

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
    const handleReceiptRead = (data: { messageIds: string[]; userId: string }) => {
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

    // Handler for presence updates
    const handlePresenceUpdate = (data: { userId: string; online: boolean; lastSeen: Date }) => {
      // Update presence cache
      queryClient.setQueryData(userKeys.presence(data.userId), {
        online: data.online,
        lastSeen: new Date(data.lastSeen),
      });
    };

    // Handler for message acknowledgment (sent back to sender)
    const handleMessageAck = (data: { tempId?: string; messageId: string; message: any }) => {
      if (!data.tempId || !data.message) {
        return;
      }

      // Mark this message as processed to prevent duplicate from pubsub
      processedMessageIds.add(data.messageId);

      const message: Message = {
        ...data.message,
        createdAt: new Date(data.message.createdAt),
        editedAt: data.message.editedAt ? new Date(data.message.editedAt) : undefined,
      };

      // Replace the optimistic message with the real one
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(message.chatId),
        (old) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.map((msg) => (msg._id === data.tempId ? message : msg)),
            })),
          };
        }
      );

      // Resolve the pending message
      resolvePendingMessage(data.tempId, message._id);
    };

    // Handler for errors
    const handleError = (data: { message: string; code?: string }) => {
      console.error('Socket error:', data);
      // You can integrate with a toast notification system here
      // For now, just log the error
    };

    // Register all event listeners
    socket.on('message:ack', handleMessageAck);
    socket.on('message:new', handleMessageNew);
    socket.on('message:edit', handleMessageEdit);
    socket.on('message:delete', handleMessageDelete);
    socket.on('receipt:delivered', handleReceiptDelivered);
    socket.on('receipt:read', handleReceiptRead);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('chat:updated', handleChatUpdated);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('error', handleError);

    // Cleanup: remove all event listeners
    return () => {
      socket.off('message:ack', handleMessageAck);
      socket.off('message:new', handleMessageNew);
      socket.off('message:edit', handleMessageEdit);
      socket.off('message:delete', handleMessageDelete);
      socket.off('receipt:delivered', handleReceiptDelivered);
      socket.off('receipt:read', handleReceiptRead);
      socket.off('typing:update', handleTypingUpdate);
      socket.off('chat:updated', handleChatUpdated);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('error', handleError);
    };
  }, [socket, queryClient, resolvePendingMessage, setTyping]);
};
