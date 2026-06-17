import {
  WaitingOnExtractionResultSchema,
  type WaitingOnExtractionResult,
  type WaitingOnItem,
} from '@repo/types';
import { AppError, logger } from '@repo/utils';
import type {
  WaitingOnExtractionContext,
  WaitingOnExtractionProvider,
} from '../waiting-on-extraction-service';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 30_000;

interface OpenRouterWaitingOnProviderOptions {
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

const SYSTEM_PROMPT = `You are Blabber's Waiting-On Tracker.
Extract only unresolved open loops from the provided chat messages.
An open loop is a request, unanswered question, promise, pending approval, unconfirmed plan, or follow-up that still appears unresolved.
Classify each item as:
- waiting_on_them: current user is waiting for someone else.
- waiting_on_me: someone else is waiting for the current user.
Do not extract completed or resolved items.
Do not invent facts, people, dates, or sourceMessageIds.
If no waiting-on items exist, return waitingOn: [].
Return valid JSON only.
No markdown, code fences, comments, or prose.
Use status "open" by default.
Use confidence between 0 and 1.
Use participant userIds only when a participant clearly matches.

Return exactly this JSON shape:
{
  "chatId": "string",
  "summary": "string",
  "waitingOn": [
    {
      "chatId": "string",
      "direction": "waiting_on_them | waiting_on_me",
      "title": "string",
      "description": "string",
      "person": { "userId": "string", "name": "string" },
      "requester": { "userId": "string", "name": "string" },
      "owner": { "userId": "string", "name": "string" },
      "status": "open",
      "priority": "low | medium | high",
      "dueDate": "string",
      "confidence": 0.82,
      "sourceMessageIds": ["sourceMessageId"],
      "sourceText": "short supporting quote",
      "relatedActionIds": []
    }
  ],
  "generatedAt": "ISO timestamp",
  "sourceMessageIds": ["sourceMessageId"]
}`;

function buildUserPrompt(context: WaitingOnExtractionContext): string {
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
      'AI waiting-on provider returned non-JSON output',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AppError(
      502,
      'AI waiting-on provider returned malformed JSON',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }
}

function normalizeWaitingOn(
  item: Partial<WaitingOnItem>,
  context: WaitingOnExtractionContext
): unknown {
  return {
    ...item,
    chatId: context.chatId,
    status: item.status ?? 'open',
    relatedActionIds: item.relatedActionIds ?? [],
    sourceMessageIds: item.sourceMessageIds ?? [],
  };
}

function normalizeResult(candidate: unknown, context: WaitingOnExtractionContext): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }

  const value = candidate as Partial<WaitingOnExtractionResult>;
  return {
    ...value,
    chatId: context.chatId,
    waitingOn: Array.isArray(value.waitingOn)
      ? value.waitingOn.map((item) => normalizeWaitingOn(item, context))
      : [],
    generatedAt: new Date().toISOString(),
    sourceMessageIds: value.sourceMessageIds ?? context.messages.map((message) => message._id),
  };
}

function citedSourceIds(result: WaitingOnExtractionResult): string[] {
  return [
    ...result.sourceMessageIds,
    ...result.waitingOn.flatMap((item) => item.sourceMessageIds),
  ];
}

function assertKnownSourceMessageIds(
  result: WaitingOnExtractionResult,
  context: WaitingOnExtractionContext
): void {
  const knownIds = new Set(context.messages.map((message) => message._id));
  const unknownIds = citedSourceIds(result).filter((id) => id && !knownIds.has(id));

  if (unknownIds.length > 0) {
    logger.warn(
      {
        unknownSourceMessageIds: Array.from(new Set(unknownIds)),
        chatId: context.chatId,
      },
      'OpenRouter waiting-on extraction cited unknown source messages'
    );
    throw new AppError(
      502,
      'AI waiting-on provider returned invalid source references',
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
    'OpenRouter waiting-on extraction request failed'
  );
  return new AppError(502, 'AI waiting-on provider is unavailable', 'AI_PROVIDER_ERROR');
}

export function createOpenRouterWaitingOnProvider(
  options: OpenRouterWaitingOnProviderOptions
): WaitingOnExtractionProvider {
  const model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async extractWaitingOn(context: WaitingOnExtractionContext): Promise<WaitingOnExtractionResult> {
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
            'AI waiting-on provider returned malformed response',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new AppError(
            502,
            'AI waiting-on provider returned empty output',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const parsedJson = parseStrictJsonObject(content);
        const parsedResult = WaitingOnExtractionResultSchema.safeParse(
          normalizeResult(parsedJson, context)
        );

        if (!parsedResult.success) {
          logger.warn(
            { issues: parsedResult.error.flatten(), chatId: context.chatId },
            'OpenRouter waiting-on extraction failed schema validation'
          );
          throw new AppError(
            502,
            'AI waiting-on provider returned invalid structured output',
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
              ? 'OpenRouter waiting-on extraction timed out'
              : error instanceof Error
                ? error.message
                : 'Unknown error',
          },
          'OpenRouter waiting-on extraction request failed'
        );

        throw new AppError(
          502,
          isAbort ? 'AI waiting-on provider timed out' : 'AI waiting-on provider is unavailable',
          'AI_PROVIDER_ERROR'
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
