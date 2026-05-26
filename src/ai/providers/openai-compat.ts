/**
 * Shared streamer for OpenAI-compatible `/chat/completions` endpoints.
 *
 * Several providers expose the same wire shape: a JSON body with
 * `{ model, messages, stream, max_tokens }`, Bearer auth, and an SSE
 * response of `data: {json}` lines terminated by `data: [DONE]`. The lines
 * carry `choices[0].delta.content` substrings.
 *
 * OpenAI is the original. Google Gemini exposes the same shape at
 * `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
 * Adding a new compatible provider is a one-file wrapper that calls this
 * with the right base URL.
 *
 * NOTE on "compatibility": real OpenAI is the reference. Other vendors are
 * compatible "enough" for the bits we use (system+user messages,
 * stream:true, delta.content). They diverge on edge fields we don't touch.
 */

import { parseSSE } from '../sse';

export type ChatCompatParams = {
  /** Full URL ending in /chat/completions */
  endpoint: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
};

export async function* streamChatCompletions(
  params: ChatCompatParams,
): AsyncGenerator<string, void, unknown> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const res = await fetchImpl(params.endpoint, {
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
    throw new Error(`HTTP ${res.status}: ${truncate(body, 200)}`);
  }
  if (!res.body) throw new Error('Empty response body');

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
