import { ChatIntelligenceSummarySchema, type ChatIntelligenceSummary } from '@repo/types';
import { AppError, logger } from '@repo/utils';
import type { AISummaryContext, AISummaryProvider } from '../ai-summary-service';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 30_000;

interface OpenRouterSummaryProviderOptions {
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

const SYSTEM_PROMPT = `You are Blabber's Summary AI.
Summarize only the provided chat messages.
Extract a unified briefing with overview, confirmed decisions, questions for the current user, important links, task suggestions, waiting-on context, and safe-to-skip material.
Preserve sourceMessageIds from the provided messages.
Do not invent facts, people, assignments, links, dates, or decisions.
For task ownership, set assignedToUserId only when the owner is clearly one of the provided participants.
For first-person commitments like "I will", resolve the owner to that message's senderId, not the current viewer.
If ownership is ambiguous, set assignedTo and assignedToUserId to null.
For dueDate, include only explicit reasonably unambiguous dates from the message; leave null when unsure.
Only mark a decision when the messages show agreement or confirmation.
Only include actual links that appear in messages.
If a field has no items, return [].
Return valid JSON only.
Do not include markdown, code fences, comments, or prose.

Return exactly this JSON shape:
{
  "summary": "string",
  "overview": "string",
  "decisions": [
    {
      "title": "string",
      "status": "proposed | final | reverted",
      "sourceMessageIds": ["sourceMessageId"]
    }
  ],
  "tasks": [
    {
      "title": "string",
      "assignedTo": "string or null",
      "assignedToUserId": "participant userId or null",
      "dueDate": "string or null",
      "status": "pending | in_progress | done | blocked",
      "sourceMessageId": "sourceMessageId"
    }
  ],
  "questionsForMe": [
    {
      "question": "string",
      "sourceMessageId": "sourceMessageId"
    }
  ],
  "importantLinks": [
    {
      "url": "valid absolute URL",
      "label": "string or null",
      "sourceMessageId": "sourceMessageId"
    }
  ],
  "waitingOn": [
    {
      "title": "string",
      "owner": "string or null",
      "dueDate": "string or null",
      "status": "waiting | done | blocked",
      "sourceMessageId": "sourceMessageId"
    }
  ],
  "noise": [
    {
      "text": "string",
      "sourceMessageId": "sourceMessageId"
    }
  ],
  "sourceMessageIds": ["sourceMessageId"],
  "generatedAt": "ISO timestamp"
}`;

function buildUserPrompt(context: AISummaryContext): string {
  return JSON.stringify(
    {
      chatId: context.chatId,
      chatTitle: context.chatTitle ?? null,
      chatDescription: context.chatDescription ?? null,
      groupContext: context.groupContext ?? null,
      currentUserId: context.currentUserId,
      currentUserName: context.currentUserName ?? null,
      participants: context.participants ?? [],
      recentMessages: context.messages.map((message) => ({
        sourceMessageId: message._id,
        senderId: message.senderId,
        senderName: message.senderName ?? null,
        timestamp: message.createdAt,
        type: message.type ?? 'text',
        content: message.body,
        media: message.media ?? null,
        poll: message.poll ?? null,
        event: message.event ?? null,
        planThis: message.planThis ?? null,
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
      'AI summary provider returned non-JSON output',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AppError(
      502,
      'AI summary provider returned malformed JSON',
      'AI_PROVIDER_INVALID_RESPONSE'
    );
  }
}

function normalizeSummary(candidate: unknown, context: AISummaryContext): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }

  const value = candidate as Partial<ChatIntelligenceSummary>;
  return {
    ...value,
    overview: value.overview ?? value.summary ?? '',
    decisions: value.decisions ?? [],
    tasks: value.tasks ?? [],
    questionsForMe: value.questionsForMe ?? [],
    importantLinks: value.importantLinks ?? [],
    waitingOn: value.waitingOn ?? [],
    noise: value.noise ?? [],
    sourceMessageIds: value.sourceMessageIds ?? context.messages.map((message) => message._id),
    generatedAt: new Date().toISOString(),
  };
}

function getCitedSourceMessageIds(summary: ChatIntelligenceSummary): string[] {
  return [
    ...summary.sourceMessageIds,
    ...summary.decisions.flatMap((decision) => decision.sourceMessageIds),
    ...summary.tasks.map((task) => task.sourceMessageId),
    ...summary.questionsForMe.map((question) => question.sourceMessageId),
    ...summary.importantLinks.map((link) => link.sourceMessageId),
    ...summary.waitingOn.map((item) => item.sourceMessageId),
    ...summary.noise.map((item) => item.sourceMessageId),
  ];
}

function assertKnownSourceMessageIds(
  summary: ChatIntelligenceSummary,
  context: AISummaryContext
): void {
  const knownIds = new Set(context.messages.map((message) => message._id));
  const unknownIds = getCitedSourceMessageIds(summary).filter((id) => id && !knownIds.has(id));

  if (unknownIds.length > 0) {
    logger.warn(
      {
        unknownSourceMessageIds: Array.from(new Set(unknownIds)),
        chatId: context.chatId,
      },
      'OpenRouter summary cited unknown source messages'
    );
    throw new AppError(
      502,
      'AI summary provider returned invalid source references',
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
    {
      statusCode,
      providerMessage: providerMessage || undefined,
    },
    'OpenRouter summary request failed'
  );

  return new AppError(502, 'AI summary provider is unavailable', 'AI_PROVIDER_ERROR');
}

export function createOpenRouterSummaryProvider(
  options: OpenRouterSummaryProviderOptions
): AISummaryProvider {
  const model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generateSummary(context: AISummaryContext): Promise<ChatIntelligenceSummary> {
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
              {
                role: 'system',
                content: SYSTEM_PROMPT,
              },
              {
                role: 'user',
                content: buildUserPrompt(context),
              },
            ],
            temperature: 0.2,
            response_format: {
              type: 'json_object',
            },
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
            'AI summary provider returned malformed response',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new AppError(
            502,
            'AI summary provider returned an empty summary',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        const parsedJson = parseStrictJsonObject(content);
        const parsedSummary = ChatIntelligenceSummarySchema.safeParse(
          normalizeSummary(parsedJson, context)
        );

        if (!parsedSummary.success) {
          logger.warn(
            {
              issues: parsedSummary.error.flatten(),
              chatId: context.chatId,
            },
            'OpenRouter summary failed schema validation'
          );
          throw new AppError(
            502,
            'AI summary provider returned invalid structured output',
            'AI_PROVIDER_INVALID_RESPONSE'
          );
        }

        assertKnownSourceMessageIds(parsedSummary.data, context);

        return parsedSummary.data;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        const isAbort = error instanceof Error && error.name === 'AbortError';
        logger.warn(
          {
            error: isAbort
              ? 'OpenRouter request timed out'
              : error instanceof Error
                ? error.message
                : 'Unknown error',
          },
          'OpenRouter summary request failed'
        );

        throw new AppError(
          502,
          isAbort ? 'AI summary provider timed out' : 'AI summary provider is unavailable',
          'AI_PROVIDER_ERROR'
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
