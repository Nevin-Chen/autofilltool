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
  temperature?: number;
  fetchImpl?: typeof fetch;
};

export function streamGemini(params: GeminiStreamParams) {
  return streamChatCompletions({ endpoint: GEMINI_URL, ...params });
}
