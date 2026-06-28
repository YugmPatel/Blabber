import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@/types/react-query';
import { useAppStore } from '@/store/app-store';
import { useAuth } from '@/contexts/AuthContext';
import { messageKeys } from './useMessages';
import type { Message } from '@repo/types';
import { normalizeMediaUrl } from '@/api/client';

interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

interface SendMessageParams {
  chatId: string;
  body: string;
  mediaId?: string;
  mediaKind?: 'image' | 'audio' | 'document';
  mediaUrl?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  mediaDuration?: number;
  type?: 'text' | 'poll' | 'sticker' | 'event';
  poll?: {
    question: string;
    options: string[];
    allowMultiple?: boolean;
    allowVoteChanges?: boolean;
    showVoters?: boolean;
    closesAt?: string;
  };
  sticker?: {
    emoji: string;
    label?: string;
  };
  event?: {
    title: string;
    startsAt: string;
    startAt?: string;
    endAt?: string;
    timezone?: string;
    location?: string;
    meetingUrl?: string;
    description?: string;
    reminderEnabled?: boolean;
  };
  replyToId?: string;
  mentions?: Array<{ userId: string; start: number; length: number; displayName?: string }>;
}

export const useSendMessage = () => {
  const socket = useAppStore((state) => state.socket);
  const addPendingMessage = useAppStore((state) => state.addPendingMessage);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const sendMessage = useCallback(
    ({
      chatId,
      body,
      mediaId,
      mediaKind,
      mediaUrl,
      mediaFileName,
      mediaMimeType,
      mediaSize,
      mediaDuration,
      type,
      poll,
      sticker,
      event,
      replyToId,
      mentions,
    }: SendMessageParams) => {
      if (!socket || !user) {
        console.error('Socket not connected or user not authenticated');
        return;
      }

      // Generate a stable client-side ID that correlates optimistic, ack, pubsub, and retry paths.
      const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const tempId = clientMessageId;

      // Create optimistic message
      const optimisticMessage: Message = {
        _id: tempId,
        chatId,
        senderId: user._id,
        clientMessageId,
        type: mediaKind ?? type ?? 'text',
        body,
        media: mediaId
          ? {
              type: mediaKind ?? 'image',
              url: normalizeMediaUrl(mediaUrl) ?? '',
              fileName: mediaFileName,
              mimeType: mediaMimeType,
              size: mediaSize,
              duration: mediaDuration,
            }
          : undefined,
        poll: poll
          ? {
              question: poll.question,
              options: poll.options.map((option, index) => ({
                id: `option-${index + 1}`,
                text: option,
                votes: [],
              })),
              allowMultiple: poll.allowMultiple ?? false,
              allowVoteChanges: poll.allowVoteChanges ?? true,
              showVoters: poll.showVoters ?? false,
              closesAt: poll.closesAt,
              currentUserVote: [],
              closed: false,
            }
          : undefined,
        sticker,
        event,
        replyTo: replyToId
          ? {
              messageId: replyToId,
              body: '', // Will be filled by server
              senderId: '',
            }
          : undefined,
        reactions: [],
        mentions: mentions?.map((mention) => ({
          userId: mention.userId,
          start: mention.start,
          length: mention.length,
          displayName: mention.displayName || '',
        })),
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
        type,
        mediaId,
        mediaDuration,
        poll,
        sticker,
        event,
        replyToId,
        mentions: mentions?.map(({ userId, start, length }) => ({ userId, start, length })),
        clientMessageId,
        tempId,
      });
    },
    [socket, user, addPendingMessage, queryClient]
  );

  return { sendMessage };
};
