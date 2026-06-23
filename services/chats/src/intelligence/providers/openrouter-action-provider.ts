import {
  ChatActionExtractionResultSchema,
  type ChatActionExtractionResult,
  type ChatActionItem,
} from '@repo/types';
import { AppError, logger } from '@repo/utils';
import type { ActionExtractionContext, ActionExtractionProvider } from '../action-extraction-service';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 30_000;

interface OpenRouterActionProviderOptions {
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

const SYSTEM_PROMPT = `You are Blabber's Chat-to-Action extraction engine.
Extract only actionable items from the provided chat messages.
Detect tasks, events, reminders, requests, promises, and follow-ups.
Return valid JSON only.
Do not include markdown, code fences, comments, or prose.
Do not invent facts, dates, people, assignments, or sourceMessageIds.
If no actions exist, return actions: [].
Use status "pending" by default.
Use confidence between 0 and 1.
Keep titles short and user-friendly.
Use participant userIds only when a participant clearly matches.

Return exactly this JSON shape:
{
  "chatId": "string",
  "summary": "string",
  "actions": [
    {
      "chatId": "string",
      "type": "task | event | reminder | request | follow_up | promise",
      "title": "string",
      "description": "string",
      "assignedTo": { "userId": "string", "name": "string" },
      "createdBy": { "userId": "string", "name": "string" },
      "dueDate": "string",
      "eventStart": "string",
      "eventEnd": "string",
      "status": "pending",
      "priority": "low | medium | high",
      "confidence": 0.86,
      "sourceMessageIds": ["sourceMessageId"],
      "sourceText": "short supporting quote"
    }
  ],
  "generatedAt": "ISO timestamp",
  "sourceMessageIds": ["sourceMessageId"]
}`;

function buildUserPrompt(context: ActionExtractionContext): string {
  return JSON.stringify(
    {
      chatId: context.chatId,
      chatTitle: context.chatTitle ?? null,
      chatDescription: context.chatDescription ?? null,
      groupContext: context.groupContext ?? null,
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
      'AI action provider returned non-JSON output',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AppError(
      502,
      'AI action provider returned malformed JSON',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }
}

function normalizeAction(action: Partial<ChatActionItem>, context: ActionExtractionContext): unknown {
  return {
    ...action,
    chatId: context.chatId,
    status: action.status ?? 'pending',
    sourceMessageIds: action.sourceMessageIds ?? [],
  };
}

function normalizeResult(candidate: unknown, context: ActionExtractionContext): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }

  const value = candidate as Partial<ChatActionExtractionResult>;
  return {
    ...value,
    chatId: context.chatId,
    actions: Array.isArray(value.actions)
      ? value.actions.map((action) => normalizeAction(action, context))
      : [],
    generatedAt: new Date().toISOString(),
    sourceMessageIds: value.sourceMessageIds ?? context.messages.map((message) => message._id),
  };
}

function citedSourceIds(result: ChatActionExtractionResult): string[] {
  return [
    ...result.sourceMessageIds,
    ...result.actions.flatMap((action) => action.sourceMessageIds),
  ];
}

function assertKnownSourceMessageIds(
  result: ChatActionExtractionResult,
  context: ActionExtractionContext
): void {
  const knownIds = new Set(context.messages.map((message) => message._id));
  const unknownIds = citedSourceIds(result).filter((id) => id && !knownIds.has(id));

  if (unknownIds.length > 0) {
    logger.warn(
      {
        unknownSourceMessageIds: Array.from(new Set(unknownIds)),
        chatId: context.chatId,
      },
      'OpenRouter action extraction cited unknown source messages'
    );
    throw new AppError(
      502,
      'AI action provider returned invalid source references',
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
    'OpenRouter action extraction request failed'
  );
  return new AppError(502, 'AI action provider is unavailable', 'AI_PROVIDER_ERROR');
}

export function createOpenRouterActionProvider(
  options: OpenRouterActionProviderOptions
): ActionExtractionProvider {
  const model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async extractActions(context: ActionExtractionContext): Promise<ChatActionExtractionResult> {
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
            'AI action provider returned malformed response',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new AppError(
            502,
            'AI action provider returned empty output',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const parsedJson = parseStrictJsonObject(content);
        const parsedResult = ChatActionExtractionResultSchema.safeParse(
          normalizeResult(parsedJson, context)
        );

        if (!parsedResult.success) {
          logger.warn(
            { issues: parsedResult.error.flatten(), chatId: context.chatId },
            'OpenRouter action extraction failed schema validation'
          );
          throw new AppError(
            502,
            'AI action provider returned invalid structured output',
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
              ? 'OpenRouter action extraction timed out'
              : error instanceof Error
                ? error.message
                : 'Unknown error',
          },
          'OpenRouter action extraction request failed'
        );

        throw new AppError(
          502,
          isAbort ? 'AI action provider timed out' : 'AI action provider is unavailable',
          'AI_PROVIDER_ERROR'
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
