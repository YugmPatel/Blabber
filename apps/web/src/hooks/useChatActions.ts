import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatActionItem, ChatActionStatus, ExtractChatActionsDTO } from '@repo/types';
import { extractChatActions, fetchChatActions, updateChatAction } from '@/api/client';
import { groupBrainKeys } from '@/hooks/useGroupBrain';

export const chatActionKeys = {
  all: ['chat-actions'] as const,
  list: (chatId: string) => [...chatActionKeys.all, chatId] as const,
};

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

  return {
    actions: actionsQuery.data?.actions ?? [],
    isLoadingActions: actionsQuery.isLoading,
    actionsError: actionsQuery.error,
    extractActions: extractMutation.mutate,
    isExtractingActions: extractMutation.isPending,
    extractError: extractMutation.error,
    updateActionStatus: updateMutation.mutate,
    isUpdatingAction: updateMutation.isPending,
    updateError: updateMutation.error,
  };
}
