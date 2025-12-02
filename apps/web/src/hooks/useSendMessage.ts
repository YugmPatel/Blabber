import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@/types/react-query';
import { useAppStore } from '@/store/app-store';
import { useAuth } from '@/contexts/AuthContext';
import { messageKeys } from './useMessages';
import type { Message } from '@repo/types';

interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

interface SendMessageParams {
  chatId: string;
  body: string;
  mediaId?: string;
  replyToId?: string;
}

export const useSendMessage = () => {
  const socket = useAppStore((state) => state.socket);
  const addPendingMessage = useAppStore((state) => state.addPendingMessage);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const sendMessage = useCallback(
    ({ chatId, body, mediaId, replyToId }: SendMessageParams) => {
      if (!socket || !user) {
        console.error('Socket not connected or user not authenticated');
        return;
      }

      // Generate temporary ID for optimistic update
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create optimistic message
      const optimisticMessage: Message = {
        _id: tempId,
        chatId,
        senderId: user._id,
        body,
        media: mediaId
          ? {
              type: 'image', // Will be updated when server responds
              url: '',
            }
          : undefined,
        replyTo: replyToId
          ? {
              messageId: replyToId,
              body: '', // Will be filled by server
              senderId: '',
            }
          : undefined,
        reactions: [],
        status: 'sent',
        deletedFor: [],
        createdAt: new Date(),
      };

      // Add to pending messages
      addPendingMessage(tempId, optimisticMessage);

      // Optimistically update the cache
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page, index) =>
            index === 0
              ? {
                  ...page,
                  messages: [optimisticMessage, ...page.messages],
                }
              : page
          ),
        };
      });

      // Emit socket event
      socket.emit('message:send', {
        chatId,
        body,
        mediaId,
        replyToId,
        tempId,
      });
    },
    [socket, user, addPendingMessage, queryClient]
  );

  return { sendMessage };
};
