import type { WaitingOnExtractionResult } from '@repo/types';
import { AppError, logger } from '@repo/utils';
import { createMockWaitingOnProvider } from './providers/mock-waiting-on-provider';
import { createOpenRouterWaitingOnProvider } from './providers/openrouter-waiting-on-provider';

export interface WaitingOnInputMessage {
  _id: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  type?: string;
  createdAt: string;
}

export interface WaitingOnParticipant {
  userId: string;
  name?: string | null;
}

export interface WaitingOnExtractionContext {
  chatId: string;
  currentUserId: string;
  currentUserName?: string | null;
  participants: WaitingOnParticipant[];
  messages: WaitingOnInputMessage[];
}

export interface WaitingOnExtractionProvider {
  extractWaitingOn(context: WaitingOnExtractionContext): Promise<WaitingOnExtractionResult>;
}

export class WaitingOnExtractionService {
  constructor(private readonly provider: WaitingOnExtractionProvider) {}

  async extractWaitingOn(context: WaitingOnExtractionContext): Promise<WaitingOnExtractionResult> {
    return this.provider.extractWaitingOn(context);
  }
}

function createUnavailableProvider(): WaitingOnExtractionProvider {
  return {
    async extractWaitingOn(): Promise<WaitingOnExtractionResult> {
      throw new AppError(
        503,
        'AI waiting-on extraction is unavailable because OPENROUTER_API_KEY is not configured',
        'AI_NOT_CONFIGURED'
      );
    },
  };
}

function shouldUseMockFallback(): boolean {
  return process.env.OPENROUTER_MOCK_FALLBACK === 'true';
}

function createFallbackProvider(
  primary: WaitingOnExtractionProvider,
  fallback: WaitingOnExtractionProvider
): WaitingOnExtractionProvider {
  return {
    async extractWaitingOn(context: WaitingOnExtractionContext): Promise<WaitingOnExtractionResult> {
      try {
        return await primary.extractWaitingOn(context);
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : 'Unknown waiting-on extraction error',
            chatId: context.chatId,
          },
          'Waiting-on extraction provider failed; using mock fallback'
        );
        return fallback.extractWaitingOn(context);
      }
    },
  };
}

export function createWaitingOnExtractionService(): WaitingOnExtractionService {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  const mockProvider = createMockWaitingOnProvider();

  if (!openRouterApiKey && shouldUseMockFallback()) {
    return new WaitingOnExtractionService(mockProvider);
  }

  if (!openRouterApiKey) {
    return new WaitingOnExtractionService(createUnavailableProvider());
  }

  const openRouterProvider = createOpenRouterWaitingOnProvider({
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL,
    referer: process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_REFERER,
  });

  if (shouldUseMockFallback()) {
    return new WaitingOnExtractionService(createFallbackProvider(openRouterProvider, mockProvider));
  }

  return new WaitingOnExtractionService(openRouterProvider);
}
