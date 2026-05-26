/**
 * Anthropic messages API, streaming.
 *
 * /v1/messages with stream:true emits typed SSE events. We care about
 * `content_block_delta` (whose `delta.text` is the next text chunk) and
 * `message_stop` (end of stream).
 *
 * The Anthropic browser API requires `anthropic-dangerous-direct-browser-access: true`
 * because by default it refuses cross-origin browser requests to avoid
 * leaking API keys via page JS. Our key never leaves the background worker
 * — it lives in chrome.storage.local — so this is the correct opt-in.
 */

import { parseSSE } from '../sse';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-haiku-20241022';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export type AnthropicStreamParams = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  fetchImpl?: typeof fetch;
};

export async function* streamAnthropic(
  params: AnthropicStreamParams,
): AsyncGenerator<string, void, unknown> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${truncate(body, 200)}`);
  }
  if (!res.body) throw new Error('Anthropic returned no response body');

  for await (const event of parseSSE(res.body)) {
    if (!event.data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      continue;
    }
    const text = extractDelta(parsed);
    if (text) yield text;
    if (isStop(parsed)) return;
  }
}

function extractDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as { type?: unknown; delta?: { type?: unknown; text?: unknown } };
  if (obj.type !== 'content_block_delta') return '';
  if (obj.delta?.type !== 'text_delta') return '';
  return typeof obj.delta.text === 'string' ? obj.delta.text : '';
}

function isStop(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { type?: unknown }).type === 'message_stop';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
