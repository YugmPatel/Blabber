import {
  DecisionExtractionResultSchema,
  type ChatDecision,
  type DecisionExtractionResult,
} from '@repo/types';
import { AppError, logger } from '@repo/utils';
import type {
  DecisionExtractionContext,
  DecisionExtractionProvider,
} from '../decision-extraction-service';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 30_000;

interface OpenRouterDecisionProviderOptions {
  apiKey: string;
  model?: string;
  referer?: string;
  fetchImpl?: typeof fetch;
}

interface OpenRouterChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

const SYSTEM_PROMPT = `You are Blabber's Decision Tracker.
Extract only decisions from the provided chat messages.
A decision is something the group/person has selected, agreed on, finalized, chosen, approved, rejected, or committed to.
Do not extract generic tasks unless they represent a final agreement.
Do not invent facts.
Do not invent sourceMessageIds.
If no decisions exist, return decisions: [].
Return valid JSON only.
No markdown, code fences, comments, or prose.
Use status "final" for clearly finalized decisions, "proposed" for tentative choices, "changed" for reversals.
Use confidence between 0 and 1.

Return exactly this JSON shape:
{
  "chatId": "string",
  "summary": "string",
  "decisions": [
    {
      "chatId": "string",
      "title": "string",
      "description": "string",
      "status": "proposed | final | changed | dismissed",
      "decidedBy": [
        {
          "userId": "string",
          "name": "string"
        }
      ],
      "decidedAt": "ISO timestamp or natural timestamp from message",
      "confidence": 0.88,
      "sourceMessageIds": ["sourceMessageId"],
      "sourceText": "short supporting quote",
      "relatedActionIds": [],
      "category": "planning | technical | financial | social | logistics | other"
    }
  ],
  "generatedAt": "ISO timestamp",
  "sourceMessageIds": ["sourceMessageId"]
}`;

function buildUserPrompt(context: DecisionExtractionContext): string {
  return JSON.stringify(
    {
      chatId: context.chatId,
      currentUserId: context.currentUserId,
      currentUserName: context.currentUserName ?? null,
      participants: context.participants,
      recentMessages: context.messages.map((message) => ({
        sourceMessageId: message._id,
        senderId: message.senderId,
        senderName: message.senderName ?? null,
        timestamp: message.createdAt,
        type: message.type ?? 'text',
        content: message.body,
      })),
    },
    null,
    2
  );
}

function parseStrictJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}') || trimmed.includes('```')) {
    throw new AppError(
      502,
      'AI decision provider returned non-JSON output',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AppError(
      502,
      'AI decision provider returned malformed JSON',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }
}

function normalizeDecision(
  decision: Partial<ChatDecision>,
  context: DecisionExtractionContext
): unknown {
  return {
    ...decision,
    chatId: context.chatId,
    status: decision.status ?? 'proposed',
    decidedBy: decision.decidedBy ?? [],
    sourceMessageIds: decision.sourceMessageIds ?? [],
    relatedActionIds: decision.relatedActionIds ?? [],
  };
}

function normalizeResult(candidate: unknown, context: DecisionExtractionContext): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }

  const value = candidate as Partial<DecisionExtractionResult>;
  return {
    ...value,
    chatId: context.chatId,
    decisions: Array.isArray(value.decisions)
      ? value.decisions.map((decision) => normalizeDecision(decision, context))
      : [],
    generatedAt: new Date().toISOString(),
    sourceMessageIds: value.sourceMessageIds ?? context.messages.map((message) => message._id),
  };
}

function citedSourceIds(result: DecisionExtractionResult): string[] {
  return [
    ...result.sourceMessageIds,
    ...result.decisions.flatMap((decision) => decision.sourceMessageIds),
  ];
}

function assertKnownSourceMessageIds(
  result: DecisionExtractionResult,
  context: DecisionExtractionContext
): void {
  const knownIds = new Set(context.messages.map((message) => message._id));
  const unknownIds = citedSourceIds(result).filter((id) => id && !knownIds.has(id));

  if (unknownIds.length > 0) {
    logger.warn(
      {
        unknownSourceMessageIds: Array.from(new Set(unknownIds)),
        chatId: context.chatId,
      },
      'OpenRouter decision extraction cited unknown source messages'
    );
    throw new AppError(
      502,
      'AI decision provider returned invalid source references',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }
}

function createProviderError(statusCode: number, body: string): AppError {
  let providerMessage = '';
  try {
    const parsed = JSON.parse(body) as OpenRouterChatCompletionResponse;
    providerMessage = parsed.error?.message || '';
  } catch {
    providerMessage = '';
  }

  logger.warn(
    { statusCode, providerMessage: providerMessage || undefined },
    'OpenRouter decision extraction request failed'
  );
  return new AppError(502, 'AI decision provider is unavailable', 'AI_PROVIDER_ERROR');
}

export function createOpenRouterDecisionProvider(
  options: OpenRouterDecisionProviderOptions
): DecisionExtractionProvider {
  const model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async extractDecisions(context: DecisionExtractionContext): Promise<DecisionExtractionResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Blabber',
        };

        if (options.referer?.trim()) {
          headers['HTTP-Referer'] = options.referer.trim();
        }

        const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildUserPrompt(context) },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
        });

        const responseText = await response.text();
        if (!response.ok) {
          throw createProviderError(response.status, responseText);
        }

        let payload: OpenRouterChatCompletionResponse;
        try {
          payload = JSON.parse(responseText) as OpenRouterChatCompletionResponse;
        } catch {
          throw new AppError(
            502,
            'AI decision provider returned malformed response',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new AppError(
            502,
            'AI decision provider returned empty output',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const parsedJson = parseStrictJsonObject(content);
        const parsedResult = DecisionExtractionResultSchema.safeParse(
          normalizeResult(parsedJson, context)
        );

        if (!parsedResult.success) {
          logger.warn(
            { issues: parsedResult.error.flatten(), chatId: context.chatId },
            'OpenRouter decision extraction failed schema validation'
          );
          throw new AppError(
            502,
            'AI decision provider returned invalid structured output',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        assertKnownSourceMessageIds(parsedResult.data, context);
        return parsedResult.data;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        const isAbort = error instanceof Error && error.name === 'AbortError';
        logger.warn(
          {
            error: isAbort
              ? 'OpenRouter decision extraction timed out'
              : error instanceof Error
                ? error.message
                : 'Unknown error',
          },
          'OpenRouter decision extraction request failed'
        );

        throw new AppError(
          502,
          isAbort ? 'AI decision provider timed out' : 'AI decision provider is unavailable',
          'AI_PROVIDER_ERROR'
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
