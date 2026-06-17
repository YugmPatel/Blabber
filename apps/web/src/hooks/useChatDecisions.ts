import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChatDecision,
  ChatDecisionStatus,
  ExtractChatDecisionsDTO,
  UpdateChatDecisionDTO,
} from '@repo/types';
import {
  deleteChatDecision,
  extractChatDecisions,
  fetchChatDecisions,
  updateChatDecision,
} from '@/api/client';
import { groupBrainKeys } from '@/hooks/useGroupBrain';

export const chatDecisionKeys = {
  all: ['chat-decisions'] as const,
  list: (chatId: string) => [...chatDecisionKeys.all, chatId] as const,
};

export function useChatDecisions(chatId: string | undefined) {
  const queryClient = useQueryClient();

  const decisionsQuery = useQuery<{ decisions: ChatDecision[] }, Error>({
    queryKey: chatDecisionKeys.list(chatId || ''),
    queryFn: async () => fetchChatDecisions(chatId || ''),
    enabled: Boolean(chatId),
  });

  const extractMutation = useMutation({
    mutationFn: async (payload?: ExtractChatDecisionsDTO) =>
      extractChatDecisions(chatId || '', payload),
    onSuccess: (data) => {
      queryClient.setQueryData(chatDecisionKeys.list(chatId || ''), {
        decisions: data.decisions,
      });
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      decisionId,
      patch,
    }: {
      decisionId: string;
      patch: UpdateChatDecisionDTO & { status?: ChatDecisionStatus };
    }) => updateChatDecision(decisionId, patch),
    onSuccess: (data) => {
      queryClient.setQueryData<{ decisions: ChatDecision[] }>(
        chatDecisionKeys.list(chatId || ''),
        (current) => ({
          decisions: (current?.decisions || []).map((decision) =>
            decision.id === data.decision.id ? data.decision : decision
          ),
        })
      );
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (decisionId: string) => {
      await deleteChatDecision(decisionId);
      return decisionId;
    },
    onSuccess: (decisionId) => {
      queryClient.setQueryData<{ decisions: ChatDecision[] }>(
        chatDecisionKeys.list(chatId || ''),
        (current) => ({
          decisions: (current?.decisions || []).filter((decision) => decision.id !== decisionId),
        })
      );
      queryClient.invalidateQueries({ queryKey: groupBrainKeys.detail(chatId || '') });
    },
  });

  return {
    decisions: decisionsQuery.data?.decisions ?? [],
    isLoadingDecisions: decisionsQuery.isLoading,
    decisionsError: decisionsQuery.error,
    extractDecisions: extractMutation.mutate,
    isExtractingDecisions: extractMutation.isPending,
    extractError: extractMutation.error,
    updateDecision: updateMutation.mutate,
    isUpdatingDecision: updateMutation.isPending,
    updateError: updateMutation.error,
    deleteDecision: deleteMutation.mutate,
    isDeletingDecision: deleteMutation.isPending,
    deleteError: deleteMutation.error,
  };
}
