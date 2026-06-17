import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateWaitingOnDTO, WaitingOnItem, WaitingOnStatus } from '@repo/types';
import {
  deleteWaitingOnItem,
  extractWaitingOnItems,
  fetchWaitingOnItems,
  updateWaitingOnItem,
} from '@/api/client';
import { groupBrainKeys } from '@/hooks/useGroupBrain';

export const waitingOnKeys = {
  all: ['waiting-on'] as const,
  list: (chatId: string) => [...waitingOnKeys.all, chatId] as const,
};

export function useWaitingOn(chatId: string | undefined) {
  const queryClient = useQueryClient();

  const waitingOnQuery = useQuery<{ waitingOn: WaitingOnItem[] }, Error>({
    queryKey: waitingOnKeys.list(chatId || ''),
    queryFn: async () => fetchWaitingOnItems(chatId || ''),
    enabled: Boolean(chatId),
  });

  const extractMutation = useMutation({
    mutationFn: async (payload?: { messageLimit?: number }) =>
      extractWaitingOnItems(chatId || '', payload),
    onSuccess: (data) => {
      queryClient.setQueryData(waitingOnKeys.list(chatId || ''), {
        waitingOn: data.waitingOn,
      });
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      itemId,
      patch,
    }: {
      itemId: string;
      patch: UpdateWaitingOnDTO & { status?: WaitingOnStatus };
    }) => updateWaitingOnItem(itemId, patch),
    onSuccess: (data) => {
      queryClient.setQueryData<{ waitingOn: WaitingOnItem[] }>(
        waitingOnKeys.list(chatId || ''),
        (current) => ({
          waitingOn: (current?.waitingOn || []).map((item) =>
            item.id === data.item.id ? data.item : item
          ),
        })
      );
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await deleteWaitingOnItem(itemId);
      return itemId;
    },
    onSuccess: (itemId) => {
      queryClient.setQueryData<{ waitingOn: WaitingOnItem[] }>(
        waitingOnKeys.list(chatId || ''),
        (current) => ({
          waitingOn: (current?.waitingOn || []).filter((item) => item.id !== itemId),
        })
      );
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  return {
    waitingOn: waitingOnQuery.data?.waitingOn ?? [],
    isLoadingWaitingOn: waitingOnQuery.isLoading,
    waitingOnError: waitingOnQuery.error,
    extractWaitingOn: extractMutation.mutate,
    isExtractingWaitingOn: extractMutation.isPending,
    extractError: extractMutation.error,
    updateWaitingOn: updateMutation.mutate,
    isUpdatingWaitingOn: updateMutation.isPending,
    updateError: updateMutation.error,
    deleteWaitingOn: deleteMutation.mutate,
    isDeletingWaitingOn: deleteMutation.isPending,
    deleteError: deleteMutation.error,
  };
}
