/**
 * OpenAI chat completions, streaming.
 *
 * Uses the v1 /chat/completions endpoint with `stream: true`. The response
 * is a server-sent-events stream where each `data:` line is either JSON or
 * the literal `[DONE]`. We yield the assistant `delta.content` substrings.
 */

import { parseSSE } from '../sse';

export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export type OpenAIStreamParams = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
};

export async function* streamOpenAI(
  params: OpenAIStreamParams,
): AsyncGenerator<string, void, unknown> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const res = await fetchImpl(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      stream: true,
      max_tokens: params.maxTokens,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${truncate(body, 200)}`);
  }
  if (!res.body) throw new Error('OpenAI returned no response body');

  for await (const event of parseSSE(res.body)) {
    if (event.data === '[DONE]') return;
    if (!event.data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      continue;
    }
    const text = extractDelta(parsed);
    if (text) yield text;
  }
}

function extractDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { delta?: { content?: unknown } } | undefined;
  const content = first?.delta?.content;
  return typeof content === 'string' ? content : '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
