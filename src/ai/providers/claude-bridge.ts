import { streamChatCompletions } from './openai-compat';

export const CLAUDE_BRIDGE_DEFAULT_MODEL = 'opus';
export const CLAUDE_BRIDGE_DEFAULT_BASE = 'http://localhost:11435';
const CHAT_PATH = '/v1/chat/completions';

export type ClaudeBridgeStreamParams = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export function streamClaudeBridge(params: ClaudeBridgeStreamParams) {
  const endpoint = resolveEndpoint(params.endpoint ?? '');
  const apiKey = params.apiKey || 'claude-bridge';
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
  if (!trimmed) return `${CLAUDE_BRIDGE_DEFAULT_BASE}${CHAT_PATH}`;
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  const noTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return `${noTrailing}${CHAT_PATH}`;
}

export function resolveOriginForPermission(raw: string): string | null {
  const trimmed = (raw || CLAUDE_BRIDGE_DEFAULT_BASE).trim();
  try {
    const u = new URL(trimmed);
    return `${u.origin}/`;
  } catch {
    return null;
  }
}
