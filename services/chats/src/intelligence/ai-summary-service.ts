import type { ChatIntelligenceSummary } from '@repo/types';
import { AppError, logger } from '@repo/utils';
import { createMockSummaryProvider } from './providers/mock-summary-provider';
import { createOpenRouterSummaryProvider } from './providers/openrouter-summary-provider';

export interface SummaryInputMessage {
  _id: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  type?: string;
  createdAt: string;
}

export interface AISummaryContext {
  chatId: string;
  currentUserId: string;
  currentUserName?: string | null;
  chatTitle?: string | null;
  chatDescription?: string | null;
  groupContext?: string | null;
  messages: SummaryInputMessage[];
}

export interface AISummaryProvider {
  generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary>;
}

export class AISummaryService {
  constructor(private readonly provider: AISummaryProvider) {}

  async generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary> {
    return this.provider.generateSummary(context);
  }
}

function createUnavailableProvider(): AISummaryProvider {
  return {
    async generateSummary(): Promise<ChatIntelligenceSummary> {
      throw new AppError(
        503,
        'AI summary is unavailable because OPENROUTER_API_KEY is not configured',
        'AI_NOT_CONFIGURED'
      );
    },
  };
}

function shouldUseMockFallback(): boolean {
  return (
    process.env.OPENROUTER_MOCK_FALLBACK === 'true' ||
    process.env.AI_SUMMARY_MOCK_FALLBACK === 'true'
  );
}

function createFallbackProvider(
  primary: AISummaryProvider,
  fallback: AISummaryProvider
): AISummaryProvider {
  return {
    async generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary> {
      try {
        return await primary.generateSummary(context);
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : 'Unknown AI summary error',
            chatId: context.chatId,
          },
          'AI summary provider failed; using mock fallback'
        );
        return fallback.generateSummary(context);
      }
    },
  };
}

export function createAISummaryService(): AISummaryService {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  const mockProvider = createMockSummaryProvider();

  if (!openRouterApiKey && shouldUseMockFallback()) {
    return new AISummaryService(mockProvider);
  }

  if (!openRouterApiKey) {
    return new AISummaryService(createUnavailableProvider());
  }

  const openRouterProvider = createOpenRouterSummaryProvider({
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL,
    referer: process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_REFERER,
  });

  if (shouldUseMockFallback()) {
    return new AISummaryService(createFallbackProvider(openRouterProvider, mockProvider));
  }

  return new AISummaryService(openRouterProvider);
}
