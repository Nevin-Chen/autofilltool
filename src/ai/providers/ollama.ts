/**
 * Ollama — local-first, open-weight model runner.
 *
 * Ollama (https://ollama.com) ships an OpenAI-compatible
 * `/v1/chat/completions` endpoint at `http://localhost:11434` by default.
 * It accepts the standard `messages: [{role,content}]` body, `stream: true`,
 * and emits `data: {...}` SSE lines terminated by `data: [DONE]`, with
 * `choices[0].delta.content` carrying the text. That means the bulk of the
 * implementation is the existing `streamChatCompletions` helper.
 *
 * Why this provider matters: it's the only fully-offline option in the AI
 * lineup. No key leaves the machine, no provider terms of service, no rate
 * limits beyond the user's hardware. The model the user runs is whatever
 * they pulled with `ollama pull <name>` — we default to `llama3.2` (Meta,
 * 3B, well-aligned, runs on most laptops). Users can override the model in
 * Options.
 *
 * Auth: Ollama ignores the Authorization header on its public endpoint. We
 * still send `Bearer ollama` if the user didn't set an API key, because the
 * shared OpenAI-compat helper sets the header unconditionally and some
 * reverse-proxy setups in front of Ollama (e.g. an API gateway on a LAN)
 * require *something* there. Users running a real auth proxy can paste
 * that proxy's token in the API key field and it flows through unchanged.
 *
 * Endpoint: defaults to localhost, but accepts an override so users can
 * point at a remote Ollama box on their LAN. We normalise: if the override
 * already ends in `/chat/completions`, use as-is; otherwise we append
 * `/v1/chat/completions` to the origin or base path.
 */

import { streamChatCompletions } from './openai-compat';

export const OLLAMA_DEFAULT_MODEL = 'llama3.2';
export const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';
const CHAT_PATH = '/v1/chat/completions';

export type OllamaStreamParams = {
  /** Optional API key (or proxy token). When empty, sent as `Bearer ollama`. */
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Base URL — http(s)://host[:port][/prefix]. Empty → localhost default. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export function streamOllama(params: OllamaStreamParams) {
  const endpoint = resolveEndpoint(params.endpoint ?? '');
  const apiKey = params.apiKey || 'ollama';
  return streamChatCompletions({
    endpoint,
    apiKey,
    model: params.model,
    system: params.system,
    user: params.user,
    maxTokens: params.maxTokens,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });
}

/**
 * Turn the user-supplied base URL into a full /chat/completions URL.
 * - Blank → `${OLLAMA_DEFAULT_BASE}/v1/chat/completions`.
 * - Already ends in `/chat/completions` → keep verbatim (advanced users).
 * - Anything else → append `/v1/chat/completions` to the origin (strip any
 *   trailing slash first so we don't double up).
 *
 * Exported for testing.
 */
export function resolveEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return `${OLLAMA_DEFAULT_BASE}${CHAT_PATH}`;
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  const noTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return `${noTrailing}${CHAT_PATH}`;
}

/**
 * The origin we need host permission for, given the user's configured
 * endpoint (or the default). Returned with a trailing slash so it can be
 * fed straight to `requestOriginPermission`. Returns `null` if the input
 * is unparseable.
 */
export function resolveOriginForPermission(raw: string): string | null {
  const trimmed = (raw || OLLAMA_DEFAULT_BASE).trim();
  try {
    const u = new URL(trimmed);
    return `${u.origin}/`;
  } catch {
    return null;
  }
}
