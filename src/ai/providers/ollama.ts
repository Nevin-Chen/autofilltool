/**
 * Ollama — the only fully-offline provider. It exposes an OpenAI-compatible
 * `/v1/chat/completions` endpoint (default http://localhost:11434), so it
 * reuses streamChatCompletions. Default model `llama3.2`; user-overridable.
 *
 * Auth: Ollama ignores the Authorization header, but the shared helper always
 * sets one, so we send `Bearer ollama` when no key is given (also satisfies
 * any LAN auth proxy in front of Ollama, whose token the user can paste in).
 * Endpoint accepts a remote-host override; see resolveEndpoint for normalising.
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
 * Base URL → full /chat/completions URL. Blank → localhost default; already
 * ends in `/chat/completions` → verbatim; else append CHAT_PATH (no double
 * slash). Exported for testing.
 */
export function resolveEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return `${OLLAMA_DEFAULT_BASE}${CHAT_PATH}`;
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  const noTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return `${noTrailing}${CHAT_PATH}`;
}

/**
 * Origin (trailing slash, for requestOriginPermission) needed for the
 * configured endpoint, or the default. `null` if unparseable.
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
