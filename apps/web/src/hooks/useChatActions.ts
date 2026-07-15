import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatActionItem, ChatActionStatus, CreateChatActionDTO, ExtractChatActionsDTO, UpdateChatActionDTO } from '@repo/types';
import { addChatActionUpdate, createChatAction, createMyAction, deleteChatAction, extractChatActions, fetchChatActions, fetchMyActions, updateChatAction } from '@/api/client';
import { groupBrainKeys } from '@/hooks/useGroupBrain';

export const chatActionKeys = {
  all: ['chat-actions'] as const,
  list: (chatId: string) => [...chatActionKeys.all, chatId] as const,
  mine: () => [...chatActionKeys.all, 'mine'] as const,
};

function replaceAction(actions: ChatActionItem[] | undefined, next: ChatActionItem) {
  return (actions || []).map((action) =>
    action.id === next.id
      ? { ...action, ...next, permissions: next.permissions ?? action.permissions }
      : action
  );
}

export function upsertOrRemoveAction(actions: ChatActionItem[] | undefined, next: ChatActionItem) {
  const current = actions || [];
  if (next.deletedAt) return current.filter((action) => action.id !== next.id);
  const exists = current.some((action) => action.id === next.id);
  if (exists) return replaceAction(current, next);
  return [next, ...current];
}

function actionBelongsInMine(action: ChatActionItem) {
  if (action.deletedAt) return true;
  if (action.visibility === 'personal') {
    return Boolean(action.personalOwnerUserId);
  }
  return Boolean(action.assignedTo?.userId || action.createdBy?.userId);
}

function upsertMineCache(
  queryClient: ReturnType<typeof useQueryClient>,
  action: ChatActionItem
) {
  if (!actionBelongsInMine(action)) return;
  queryClient.setQueryData<{ actions: ChatActionItem[] }>(chatActionKeys.mine(), (current) => ({
    actions: upsertOrRemoveAction(current?.actions, action),
  }));
}

function writableStatus(status: ChatActionStatus): 'open' | 'in_progress' | 'completed' {
  if (status === 'completed' || status === 'dismissed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'open';
}

export function useMyActions() {
  const queryClient = useQueryClient();
  const actionsQuery = useQuery<{ actions: ChatActionItem[] }, Error>({
    queryKey: chatActionKeys.mine(),
    queryFn: fetchMyActions,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ actionId, patch }: { actionId: string; patch: UpdateChatActionDTO }) =>
      updateChatAction(actionId, patch),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(chatActionKeys.mine(), (current) => ({
        actions: replaceAction(current?.actions, data.action),
      }));
      queryClient.invalidateQueries({ queryKey: chatActionKeys.all });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: CreateChatActionDTO) => createMyAction(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(chatActionKeys.mine(), (current) => ({
        actions: upsertOrRemoveAction(current?.actions, data.action),
      }));
      queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ actionId, reason }: { actionId: string; reason?: string }) => deleteChatAction(actionId, reason),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(chatActionKeys.mine(), (current) => ({
        actions: upsertOrRemoveAction(current?.actions, data.action),
      }));
      queryClient.invalidateQueries({ queryKey: chatActionKeys.all });
    },
  });

  const addUpdateMutation = useMutation({
    mutationFn: async ({ actionId, body }: { actionId: string; body: string }) => addChatActionUpdate(actionId, body),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(chatActionKeys.mine(), (current) => ({
        actions: replaceAction(current?.actions, data.action),
      }));
      queryClient.invalidateQueries({ queryKey: chatActionKeys.all });
    },
  });

  return {
    actions: actionsQuery.data?.actions ?? [],
    isLoading: actionsQuery.isLoading,
    error: actionsQuery.error,
    updateAction: updateMutation.mutate,
    createAction: createMutation.mutate,
    updateActionStatus: ({ actionId, status }: { actionId: string; status: ChatActionStatus }) =>
      updateMutation.mutate({ actionId, patch: { status: writableStatus(status) } }),
    addActionUpdate: addUpdateMutation.mutate,
    deleteAction: deleteMutation.mutate,
    isCreatingAction: createMutation.isPending,
    isUpdating: createMutation.isPending || updateMutation.isPending || addUpdateMutation.isPending || deleteMutation.isPending,
    updateError: createMutation.error || updateMutation.error || addUpdateMutation.error || deleteMutation.error,
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
    mutationFn: async ({ actionId, patch }: { actionId: string; patch: UpdateChatActionDTO }) =>
      updateChatAction(actionId, patch),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(
        chatActionKeys.list(chatId || ''),
        (current) => ({
          actions: replaceAction(current?.actions, data.action),
        })
      );
      upsertMineCache(queryClient, data.action);
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const addUpdateMutation = useMutation({
    mutationFn: async ({ actionId, body }: { actionId: string; body: string }) => addChatActionUpdate(actionId, body),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(
        chatActionKeys.list(chatId || ''),
        (current) => ({ actions: replaceAction(current?.actions, data.action) })
      );
      upsertMineCache(queryClient, data.action);
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ actionId, reason }: { actionId: string; reason?: string }) => deleteChatAction(actionId, reason),
    onSuccess: (data) => {
      queryClient.setQueryData<{ actions: ChatActionItem[] }>(
        chatActionKeys.list(chatId || ''),
        (current) => ({ actions: upsertOrRemoveAction(current?.actions, data.action) })
      );
      upsertMineCache(queryClient, data.action);
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
      upsertMineCache(queryClient, data.action);
      queryClient.invalidateQueries({ queryKey: chatActionKeys.mine() });
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
    updateAction: updateMutation.mutate,
    updateActionStatus: ({ actionId, status }: { actionId: string; status: ChatActionStatus }) =>
      updateMutation.mutate({ actionId, patch: { status: writableStatus(status) } }),
    addActionUpdate: addUpdateMutation.mutate,
    deleteAction: deleteMutation.mutate,
    isUpdatingAction: updateMutation.isPending || addUpdateMutation.isPending || deleteMutation.isPending,
    updateError: updateMutation.error || addUpdateMutation.error || deleteMutation.error,
    createAction: createMutation.mutate,
    isCreatingAction: createMutation.isPending,
    createError: createMutation.error,
  };
}
