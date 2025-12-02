import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '../types/react-query';
import { apiClient } from '../api/client';
import type { Message, CreateMessageDTO, UpdateMessageDTO, AddReactionDTO } from '@repo/types';

// Query keys
export const messageKeys = {
  all: ['messages'] as const,
  lists: () => [...messageKeys.all, 'list'] as const,
  list: (chatId: string) => [...messageKeys.lists(), chatId] as const,
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
      const response = await apiClient.post<{ message: Message }>(`/api/messages/${chatId}`, data);
      return response.data.message;
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
              body: newMessage.body,
              media: newMessage.mediaId
                ? {
                    type: 'image', // Placeholder
                    url: '',
                  }
                : undefined,
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
                    msg._id === newMessage._id || msg._id === newMessage.tempId ? newMessage : msg
                  ),
                }
              : page
          ),
        };
      });
    },
  });
};

// Edit message
export const useEditMessage = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, data }: { messageId: string; data: UpdateMessageDTO }) => {
      const response = await apiClient.patch<{ message: Message }>(
        `/api/messages/${messageId}`,
        data
      );
      return response.data.message;
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
      const response = await apiClient.post<{ message: Message }>(
        `/api/messages/${messageId}/react`,
        data
      );
      return response.data.message;
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

// Mark messages as read
export const useMarkMessagesRead = (chatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageIds: string[]) => {
      await apiClient.post(`/api/messages/${messageIds[0]}/read`, { messageIds });
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
