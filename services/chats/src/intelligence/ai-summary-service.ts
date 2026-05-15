import type { ChatIntelligenceSummary } from '@repo/types';
import { createMockSummaryProvider } from './providers/mock-summary-provider';

export interface SummaryInputMessage {
  _id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface AISummaryContext {
  chatId: string;
  currentUserId: string;
  messages: SummaryInputMessage[];
}

export interface AISummaryProvider {
  generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary>;
}

function hasAnyAIKey(): boolean {
  return Boolean(
    process.env.AI_SUMMARY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      process.env.GEMINI_API_KEY
  );
}

export class AISummaryService {
  constructor(private readonly provider: AISummaryProvider) {}

  async generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary> {
    return this.provider.generateSummary(context);
  }
}

export function createAISummaryService(): AISummaryService {
  if (!hasAnyAIKey()) {
    return new AISummaryService(createMockSummaryProvider());
  }

  // API keys may be set for future providers (OpenAI, Claude, Gemini); until wired, keep deterministic mock.
  return new AISummaryService(createMockSummaryProvider());
}