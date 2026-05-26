/**
 * OpenAI chat completions, streaming.
 *
 * Tiny wrapper over `streamChatCompletions` — OpenAI is the reference
 * implementation of the OpenAI-compatible shape, so this is just URL +
 * default model.
 */

import { streamChatCompletions } from './openai-compat';

export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export type OpenAIStreamParams = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  fetchImpl?: typeof fetch;
};

export function streamOpenAI(params: OpenAIStreamParams) {
  return streamChatCompletions({ endpoint: OPENAI_URL, ...params });
}
