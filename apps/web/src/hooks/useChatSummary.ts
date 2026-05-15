import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatIntelligenceSummary, SummarizeChatDTO } from '@repo/types';
import { fetchLatestChatSummary, generateChatSummary } from '@/api/client';

export const chatSummaryKeys = {
  all: ['chat-summary'] as const,
  detail: (chatId: string) => [...chatSummaryKeys.all, chatId] as const,
};

export function useChatSummary(chatId: string | undefined) {
  const queryClient = useQueryClient();

  const summaryQuery = useQuery<{ summary: ChatIntelligenceSummary | null }, Error>({
    queryKey: chatSummaryKeys.detail(chatId || ''),
    queryFn: async () => fetchLatestChatSummary(chatId || ''),
    enabled: Boolean(chatId),
  });

  const generateMutation = useMutation({
    mutationFn: async (payload?: SummarizeChatDTO) => generateChatSummary(chatId || '', payload),
    onSuccess: (data) => {
      queryClient.setQueryData(chatSummaryKeys.detail(chatId || ''), {
        summary: data.summary,
      });
    },
  });

  return {
    summary: summaryQuery.data?.summary ?? null,
    isLoadingSummary: summaryQuery.isLoading,
    isFetchingSummary: summaryQuery.isFetching,
    summaryError: summaryQuery.error,
    generateSummary: generateMutation.mutate,
    isGeneratingSummary: generateMutation.isPending,
    generateError: generateMutation.error,
  };
}