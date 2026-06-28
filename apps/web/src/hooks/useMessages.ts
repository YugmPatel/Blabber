import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '../types/react-query';
import { apiClient, cancelEvent, closePoll, downloadEventIcs, forwardMessage as forwardMessageRequest, fetchMessagePins, fetchSavedMessages, fetchSharedContent, pinMessage, rsvpEvent, saveMessage, unpinMessage, unsaveMessage, updateEvent } from '../api/client';
import type { SharedContentResponse, SharedContentType } from '../api/client';
import { chatKeys } from './useChats';
import type {
  Message,
  CreateMessageDTO,
  UpdateMessageDTO,
  AddReactionDTO,
  PollVoteDTO,
  UpdateEventDTO,
} from '@repo/types';

// Query keys
export const messageKeys = {
  all: ['messages'] as const,
  lists: () => [...messageKeys.all, 'list'] as const,
  list: (chatId: string) => [...messageKeys.lists(), chatId] as const,
  pins: (chatId: string) => [...messageKeys.all, 'pins', chatId] as const,
  saved: () => [...messageKeys.all, 'saved'] as const,
  shared: (chatId: string, type: SharedContentType) => [...messageKeys.all, 'shared', chatId, type] as const,
};

// Response type for paginated messages
interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

// Fetch messages with infinite scroll
export const useMessages = (chatId: string | undefined, limit: number = 50) => {
  return useInfiniteQuery<MessagesResponse, Error>({
    queryKey: messageKeys.list(chatId || ''),
    queryFn: async ({ pageParam }) => {
      const { data } = await apiClient.get<MessagesResponse>(`/api/messages/${chatId}`, {
        params: {
          cursor: pageParam,
          limit,
        },
      });
      return data;
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!chatId,
  });
};

// Send message
export const useSendMessage = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMessageDTO) => {
      const response = await apiClient.post<Message>(`/api/messages/${chatId}`, data);
      return response.data;
    },
    onMutate: async (newMessage) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: messageKeys.list(chatId) });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<InfiniteData<MessagesResponse>>(
        messageKeys.list(chatId)
      );

      // Optimistically update to the new value
      if (newMessage.tempId) {
        queryClient.setQueryData<InfiniteData<MessagesResponse>>(
          messageKeys.list(chatId),
          (old) => {
            if (!old) return old;

            const optimisticMessage: Message = {
              _id: newMessage.tempId!,
              chatId,
              senderId: '', // Will be filled by server
              type: newMessage.type ?? (newMessage.mediaId ? 'image' : 'text'),
              body: newMessage.body,
              media: newMessage.mediaId
                ? {
                    type: 'image', // Placeholder
                    url: '',
                  }
                : undefined,
              poll: newMessage.poll
                ? {
                    question: newMessage.poll.question,
                    options: newMessage.poll.options.map((option, index) => ({
                      id: `option-${index + 1}`,
                      text: option,
                      votes: [],
                    })),
                    allowMultiple: newMessage.poll.allowMultiple ?? false,
                    allowVoteChanges: newMessage.poll.allowVoteChanges ?? true,
                    showVoters: newMessage.poll.showVoters ?? false,
                    closesAt: newMessage.poll.closesAt,
                    currentUserVote: [],
                    closed: false,
                  }
                : undefined,
              sticker: newMessage.sticker,
              event: newMessage.event,
              replyTo: undefined,
              reactions: [],
              status: 'sent',
              deletedFor: [],
              createdAt: new Date(),
            };

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
          }
        );
      }

      return { previousMessages };
    },
    onError: (_err, _newMessage, context) => {
      // Rollback on error
      if (context?.previousMessages) {
        queryClient.setQueryData(messageKeys.list(chatId), context.previousMessages);
      }
    },
    onSuccess: (newMessage) => {
      const tempId = (newMessage as Message & { tempId?: string }).tempId;

      // Update the cache with the real message
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page, index) =>
            index === 0
              ? {
                  ...page,
                  messages: page.messages.map((msg) =>
                    msg._id === newMessage._id || msg._id === tempId ? newMessage : msg
                  ),
                }
              : page
          ),
        };
      });

      queryClient.getQueryCache().findAll({ queryKey: chatKeys.lists() }).forEach((query) => {
        queryClient.setQueryData(query.queryKey, (old: unknown) => {
          if (!Array.isArray(old)) return old;
          return old.map((chat) =>
            chat && typeof chat === 'object' && '_id' in chat && chat._id === chatId
              ? { ...chat, unreadCount: 0 }
              : chat
          );
        });
      });
    },
  });
};

function replaceMessageInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  chatId: string,
  updatedMessage: Message
) {
  queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
    if (!old) return old;

    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        messages: page.messages.map((msg) =>
          msg._id === updatedMessage._id ? updatedMessage : msg
        ),
      })),
    };
  });
}

export const useForwardMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      destinationChatIds,
    }: {
      messageId: string;
      destinationChatIds: string[];
    }) => forwardMessageRequest(messageId, destinationChatIds),
    onSuccess: (data) => {
      data.messages.forEach((message) => {
        queryClient.setQueryData<InfiniteData<MessagesResponse>>(
          messageKeys.list(message.chatId),
          (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((page, index) =>
                index === 0
                  ? {
                      ...page,
                      messages: page.messages.some((existing) => existing._id === message._id)
                        ? page.messages
                        : [message, ...page.messages],
                    }
                  : page
              ),
            };
          }
        );
      });
      queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
    },
  });
};

export const useMessagePins = (chatId: string | undefined) => {
  return useQuery({
    queryKey: messageKeys.pins(chatId || ''),
    queryFn: () => fetchMessagePins(chatId!),
    enabled: Boolean(chatId),
  });
};

export const usePinMessage = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: pinMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.pins(chatId) });
      queryClient.invalidateQueries({ queryKey: messageKeys.list(chatId) });
    },
  });
};

export const useUnpinMessage = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unpinMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.pins(chatId) });
      queryClient.invalidateQueries({ queryKey: messageKeys.list(chatId) });
    },
  });
};

export const useSavedMessages = () => {
  return useQuery({
    queryKey: messageKeys.saved(),
    queryFn: fetchSavedMessages,
  });
};

export const useSharedContent = (
  chatId: string | undefined,
  type: SharedContentType,
  limit = 30
) => {
  return useInfiniteQuery<
    SharedContentResponse,
    Error,
    InfiniteData<SharedContentResponse>,
    ReturnType<typeof messageKeys.shared>,
    string | undefined
  >({
    queryKey: messageKeys.shared(chatId || '', type),
    queryFn: ({ pageParam }) =>
      fetchSharedContent({ chatId: chatId!, type, cursor: pageParam, limit }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(chatId),
  });
};

export const useSaveMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMessage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messageKeys.saved() }),
  });
};

export const useUnsaveMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unsaveMessage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: messageKeys.saved() }),
  });
};

// Edit message
export const useEditMessage = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, data }: { messageId: string; data: UpdateMessageDTO }) => {
      const response = await apiClient.patch<Message>(`/api/messages/${messageId}`, data);
      return response.data;
    },
    onSuccess: (updatedMessage) => {
      // Update the message in the cache
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) =>
              msg._id === updatedMessage._id ? updatedMessage : msg
            ),
          })),
        };
      });
    },
  });
};

// Delete message
export const useDeleteMessage = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageId: string) => {
      await apiClient.delete(`/api/messages/${messageId}`);
      return messageId;
    },
    onSuccess: (deletedMessageId) => {
      // Remove the message from the cache (or mark as deleted)
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.filter((msg) => msg._id !== deletedMessageId),
          })),
        };
      });
    },
  });
};

// Add reaction to message
export const useAddReaction = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, data }: { messageId: string; data: AddReactionDTO }) => {
      const response = await apiClient.post<Message>(`/api/messages/${messageId}/react`, data);
      return response.data;
    },
    onSuccess: (updatedMessage) => {
      // Update the message in the cache
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) =>
              msg._id === updatedMessage._id ? updatedMessage : msg
            ),
          })),
        };
      });
    },
  });
};

// Vote on a poll message
export const useVotePoll = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, data }: { messageId: string; data: PollVoteDTO }) => {
      const response = await apiClient.post<Message>(
        `/api/messages/${messageId}/poll/vote`,
        data
      );
      return response.data;
    },
    onSuccess: (updatedMessage) => {
      replaceMessageInCache(queryClient, chatId, updatedMessage);
    },
  });
};

export const useClosePoll = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => closePoll(messageId),
    onSuccess: (updatedMessage) => replaceMessageInCache(queryClient, chatId, updatedMessage),
  });
};

export const useRsvpEvent = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, status }: { messageId: string; status: 'going' | 'maybe' | 'declined' }) =>
      rsvpEvent(messageId, status),
    onSuccess: (updatedMessage) => replaceMessageInCache(queryClient, chatId, updatedMessage),
  });
};

export const useCancelEvent = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => cancelEvent(messageId),
    onSuccess: (updatedMessage) => replaceMessageInCache(queryClient, chatId, updatedMessage),
  });
};

export const useUpdateEvent = (chatId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, data }: { messageId: string; data: UpdateEventDTO }) =>
      updateEvent(messageId, data),
    onSuccess: (updatedMessage) => replaceMessageInCache(queryClient, chatId, updatedMessage),
  });
};

export const useDownloadEventIcs = () => {
  return useMutation({
    mutationFn: async (messageId: string) => downloadEventIcs(messageId),
  });
};

// Mark messages as read
export const useMarkMessagesRead = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageIds: string[]) => {
      await apiClient.post('/api/messages/read', { messageIds });
    },
    onSuccess: (_data, messageIds) => {
      // Update message statuses in the cache
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(messageKeys.list(chatId), (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) =>
              messageIds.includes(msg._id) ? { ...msg, status: 'read' as const } : msg
            ),
          })),
        };
      });
    },
  });
};
