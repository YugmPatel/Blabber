import type { DecisionExtractionResult } from '@repo/types';
import { logger } from '@repo/utils';
import { createMockDecisionProvider } from './providers/mock-decision-provider';
import { createOpenRouterDecisionProvider } from './providers/openrouter-decision-provider';

export interface DecisionInputMessage {
  _id: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  type?: string;
  createdAt: string;
}

export interface DecisionParticipant {
  userId: string;
  name?: string | null;
}

export interface DecisionExtractionContext {
  chatId: string;
  currentUserId: string;
  currentUserName?: string | null;
  participants: DecisionParticipant[];
  messages: DecisionInputMessage[];
}

export interface DecisionExtractionProvider {
  extractDecisions(context: DecisionExtractionContext): Promise<DecisionExtractionResult>;
}

export class DecisionExtractionService {
  constructor(private readonly provider: DecisionExtractionProvider) {}

  async extractDecisions(context: DecisionExtractionContext): Promise<DecisionExtractionResult> {
    return this.provider.extractDecisions(context);
  }
}

function shouldUseMockFallback(): boolean {
  return process.env.OPENROUTER_MOCK_FALLBACK === 'true';
}

function createFallbackProvider(
  primary: DecisionExtractionProvider,
  fallback: DecisionExtractionProvider
): DecisionExtractionProvider {
  return {
    async extractDecisions(context: DecisionExtractionContext): Promise<DecisionExtractionResult> {
      try {
        return await primary.extractDecisions(context);
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : 'Unknown decision extraction error',
            chatId: context.chatId,
          },
          'Decision extraction provider failed; using mock fallback'
        );
        return fallback.extractDecisions(context);
      }
    },
  };
}

export function createDecisionExtractionService(): DecisionExtractionService {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  const mockProvider = createMockDecisionProvider();

  if (!openRouterApiKey) {
    return new DecisionExtractionService(mockProvider);
  }

  const openRouterProvider = createOpenRouterDecisionProvider({
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL,
    referer: process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_REFERER,
  });

  if (shouldUseMockFallback()) {
    return new DecisionExtractionService(createFallbackProvider(openRouterProvider, mockProvider));
  }

  return new DecisionExtractionService(openRouterProvider);
}
