/**
 * Google Gemini via its OpenAI-compatible /chat/completions endpoint — a thin
 * wrapper over streamChatCompletions. Recommended default because Gemini has a
 * real free tier (no card); `gemini-2.5-flash` is the free default, overridable.
 */

import { streamChatCompletions } from './openai-compat';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export type GeminiStreamParams = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  fetchImpl?: typeof fetch;
};

export function streamGemini(params: GeminiStreamParams) {
  return streamChatCompletions({ endpoint: GEMINI_URL, ...params });
}
