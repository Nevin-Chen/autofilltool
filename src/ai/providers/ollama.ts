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
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
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
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });
}

export function resolveEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return `${OLLAMA_DEFAULT_BASE}${CHAT_PATH}`;
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  const noTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return `${noTrailing}${CHAT_PATH}`;
}

export function resolveOriginForPermission(raw: string): string | null {
  const trimmed = (raw || OLLAMA_DEFAULT_BASE).trim();
  try {
    const u = new URL(trimmed);
    return `${u.origin}/`;
  } catch {
    return null;
  }
}
