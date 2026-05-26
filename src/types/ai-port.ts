/**
 * Wire shape for the streaming AI suggestion port.
 *
 * Content script connects via chrome.runtime.connect({ name: 'ai-suggest' }),
 * sends one StartMsg, then receives a sequence of DeltaMsg / DoneMsg / ErrorMsg.
 *
 * Streaming over chrome.runtime.sendMessage isn't supported (one request,
 * one response). Long-lived Ports support arbitrary back-and-forth, which
 * fits SSE-style token streaming cleanly.
 */

import type { SuggestRequest } from '@/ai/client';

export const AI_PORT_NAME = 'ai-suggest';

export type AiClientToBg = { kind: 'start'; req: SuggestRequest } | { kind: 'cancel' };

export type AiBgToClient =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function isAiClientMsg(v: unknown): v is AiClientToBg {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  return k === 'start' || k === 'cancel';
}
