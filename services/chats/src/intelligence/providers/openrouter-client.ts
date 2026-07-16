import { logger } from '@repo/utils';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterChatOptions {
  apiKey?: string;
  model?: string;
  referer?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin, provider-agnostic OpenRouter chat-completion caller. Reads the same
 * env vars already used by the intelligence/providers/openrouter-*-provider.ts
 * factories (OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_HTTP_REFERER /
 * OPENROUTER_REFERER) unless overridden. Never throws and never exposes keys
 * beyond this process — returns null on any failure (missing config, network
 * error, timeout, non-2xx, empty content) so callers always have a
 * deterministic fallback path. Only high-level failure reasons are logged,
 * never prompt/answer content.
 */
export async function callOpenRouterChat(options: OpenRouterChatOptions): Promise<string | null> {
  const apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY)?.trim();
  const model = (options.model ?? process.env.OPENROUTER_MODEL)?.trim();
  if (!apiKey || !model) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    const referer = options.referer ?? (process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_REFERER);
    if (referer) headers['HTTP-Referer'] = referer;

    const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userPrompt },
        ],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 400,
      }),
    });

    if (!response.ok) throw new Error(`openrouter_${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (error) {
    logger.warn(
      { feature: 'veyra_openrouter', reason: error instanceof Error ? error.message : 'unknown_openrouter_error' },
      'OpenRouter chat completion failed; caller will use a deterministic fallback'
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
