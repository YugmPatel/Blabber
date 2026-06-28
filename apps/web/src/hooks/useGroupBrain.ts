import { useMutation, useQuery } from '@tanstack/react-query';
import type { GroupBrain } from '@repo/types';
import { askGroupBrain, fetchGroupBrain } from '@/api/client';

export const groupBrainKeys = {
  all: ['group-brain'] as const,
  detail: (chatId: string) => [...groupBrainKeys.all, chatId] as const,
};

export function useGroupBrain(chatId: string | undefined) {
  const brainQuery = useQuery<{ brain: GroupBrain }, Error>({
    queryKey: groupBrainKeys.detail(chatId || ''),
    queryFn: async () => fetchGroupBrain(chatId || ''),
    enabled: Boolean(chatId),
  });

  const askMutation = useMutation({
    mutationFn: async (question: string) => askGroupBrain(chatId || '', question),
  });

  return {
    brain: brainQuery.data?.brain ?? null,
    isLoadingBrain: brainQuery.isLoading,
    isFetchingBrain: brainQuery.isFetching,
    brainError: brainQuery.error,
    refetchBrain: brainQuery.refetch,
    askBrain: askMutation.mutateAsync,
    isAskingBrain: askMutation.isPending,
    askBrainError: askMutation.error,
  };
}
