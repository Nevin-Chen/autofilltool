/**
 * Google Gemini, via the OpenAI-compatible endpoint.
 *
 * Google ships an OpenAI-shaped /chat/completions at
 * `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
 * that accepts a Bearer API key, `stream:true`, and the standard
 * `messages: [{role,content}]` body. The streamed deltas come back in the
 * same `choices[0].delta.content` shape — so this provider is a tiny
 * wrapper over the shared streamChatCompletions helper.
 *
 * Why this matters: Google's Gemini API has a real free tier (no card to
 * start), so this is the default we recommend for users who don't have an
 * OpenAI / Anthropic balance. `gemini-2.5-flash` is the current free
 * default; users can override the model in Options.
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
