import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatActionItem, ChatActionStatus, CreateChatActionDTO, ExtractChatActionsDTO } from '@repo/types';
import { createChatAction, extractChatActions, fetchChatActions, fetchMyActions, updateChatAction } from '@/api/client';
import { groupBrainKeys } from '@/hooks/useGroupBrain';

export const chatActionKeys = {
  all: ['chat-actions'] as const,
  list: (chatId: string) => [...chatActionKeys.all, chatId] as const,
  mine: () => [...chatActionKeys.all, 'mine'] as const,
};

export function useMyActions() {
  const queryClient = useQueryClient();
  const actionsQuery = useQuery<{ actions: ChatActionItem[] }, Error>({
    queryKey: chatActionKeys.mine(),
    queryFn: fetchMyActions,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ actionId, status }: { actionId: string; status: ChatActionStatus }) =>
      updateChatAction(actionId, { status }),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(chatActionKeys.mine(), (current) => ({
        actions: (current?.actions || []).map((action) =>
          action.id === data.action.id ? { ...action, ...data.action } : action
        ),
      }));
      queryClient.invalidateQueries({ queryKey: chatActionKeys.all });
    },
  });

  return {
    actions: actionsQuery.data?.actions ?? [],
    isLoading: actionsQuery.isLoading,
    error: actionsQuery.error,
    updateActionStatus: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error,
  };
}

export function useChatActions(chatId: string | undefined) {
  const queryClient = useQueryClient();

  const actionsQuery = useQuery<{ actions: ChatActionItem[] }, Error>({
    queryKey: chatActionKeys.list(chatId || ''),
    queryFn: async () => fetchChatActions(chatId || ''),
    enabled: Boolean(chatId),
  });

  const extractMutation = useMutation({
    mutationFn: async (payload?: ExtractChatActionsDTO) => extractChatActions(chatId || '', payload),
    onSuccess: (data) => {
      queryClient.setQueryData(chatActionKeys.list(chatId || ''), {
        actions: data.actions,
      });
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ actionId, status }: { actionId: string; status: ChatActionStatus }) =>
      updateChatAction(actionId, { status }),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(
        chatActionKeys.list(chatId || ''),
        (current) => ({
          actions: (current?.actions || []).map((action) =>
            action.id === data.action.id ? data.action : action
          ),
        })
      );
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: CreateChatActionDTO) => createChatAction(chatId || '', payload),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(
        chatActionKeys.list(chatId || ''),
        (current) => {
          const existing = current?.actions || [];
          const withoutDuplicate = existing.filter((action) => action.id !== data.action.id);
          return { actions: [data.action, ...withoutDuplicate] };
        }
      );
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  return {
    actions: actionsQuery.data?.actions ?? [],
    isLoadingActions: actionsQuery.isLoading,
    actionsError: actionsQuery.error,
    refetchActions: actionsQuery.refetch,
    extractActions: extractMutation.mutate,
    isExtractingActions: extractMutation.isPending,
    extractError: extractMutation.error,
    updateActionStatus: updateMutation.mutate,
    isUpdatingAction: updateMutation.isPending,
    updateError: updateMutation.error,
    createAction: createMutation.mutate,
    isCreatingAction: createMutation.isPending,
    createError: createMutation.error,
  };
}
