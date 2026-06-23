import type { ChatActionExtractionResult } from '@repo/types';
import { AppError, logger } from '@repo/utils';
import { createMockActionProvider } from './providers/mock-action-provider';
import { createOpenRouterActionProvider } from './providers/openrouter-action-provider';

export interface ActionInputMessage {
  _id: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  type?: string;
  createdAt: string;
}

export interface ActionParticipant {
  userId: string;
  name?: string | null;
}

export interface ActionExtractionContext {
  chatId: string;
  currentUserId: string;
  currentUserName?: string | null;
  chatTitle?: string | null;
  chatDescription?: string | null;
  groupContext?: string | null;
  participants: ActionParticipant[];
  messages: ActionInputMessage[];
}

export interface ActionExtractionProvider {
  extractActions(context: ActionExtractionContext): Promise<ChatActionExtractionResult>;
}

export class ActionExtractionService {
  constructor(private readonly provider: ActionExtractionProvider) {}

  async extractActions(context: ActionExtractionContext): Promise<ChatActionExtractionResult> {
    return this.provider.extractActions(context);
  }
}

function createUnavailableProvider(): ActionExtractionProvider {
  return {
    async extractActions(): Promise<ChatActionExtractionResult> {
      throw new AppError(
        503,
        'AI action extraction is unavailable because OPENROUTER_API_KEY is not configured',
        'AI_NOT_CONFIGURED'
      );
    },
  };
}

function shouldUseMockFallback(): boolean {
  return process.env.OPENROUTER_MOCK_FALLBACK === 'true';
}

function createFallbackProvider(
  primary: ActionExtractionProvider,
  fallback: ActionExtractionProvider
): ActionExtractionProvider {
  return {
    async extractActions(context: ActionExtractionContext): Promise<ChatActionExtractionResult> {
      try {
        return await primary.extractActions(context);
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : 'Unknown action extraction error',
            chatId: context.chatId,
          },
          'Action extraction provider failed; using mock fallback'
        );
        return fallback.extractActions(context);
      }
    },
  };
}

export function createActionExtractionService(): ActionExtractionService {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  const mockProvider = createMockActionProvider();

  if (!openRouterApiKey && shouldUseMockFallback()) {
    return new ActionExtractionService(mockProvider);
  }

  if (!openRouterApiKey) {
    return new ActionExtractionService(createUnavailableProvider());
  }

  const openRouterProvider = createOpenRouterActionProvider({
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL,
    referer: process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_REFERER,
  });

  if (shouldUseMockFallback()) {
    return new ActionExtractionService(createFallbackProvider(openRouterProvider, mockProvider));
  }

  return new ActionExtractionService(openRouterProvider);
}
