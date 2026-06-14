import type { AiProvider } from '@/profile/schema';

export type VoiceBudget = {
  voiceCharBudget: number;
  exemplarCharBudget: number;
  maxExemplars: number;
};

const CLOUD_BUDGET: VoiceBudget = {
  voiceCharBudget: 6000,
  exemplarCharBudget: 4000,
  maxExemplars: 2,
};

const LARGE_LOCAL_BUDGET: VoiceBudget = {
  voiceCharBudget: 4000,
  exemplarCharBudget: 3000,
  maxExemplars: 2,
};

const SMALL_LOCAL_BUDGET: VoiceBudget = {
  voiceCharBudget: 1200,
  exemplarCharBudget: 1200,
  maxExemplars: 1,
};

const DISABLED_BUDGET: VoiceBudget = {
  voiceCharBudget: 0,
  exemplarCharBudget: 0,
  maxExemplars: 0,
};

const LARGE_LOCAL_PREFIXES = [
  'qwen2.5',
  'qwen3',
  'llama3.1',
  'llama3.3',
  'mistral-nemo',
];

const LARGE_LOCAL_TAG_RE = /:(7|8|13|14)b\b/i;

export function budgetForProvider(
  provider: AiProvider,
  model: string,
): VoiceBudget {
  if (provider === 'none') return DISABLED_BUDGET;
  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    return CLOUD_BUDGET;
  }
  if (provider === 'ollama') {
    const m = (model ?? '').toLowerCase();
    if (LARGE_LOCAL_PREFIXES.some((p) => m.startsWith(p))) return LARGE_LOCAL_BUDGET;
    if (LARGE_LOCAL_TAG_RE.test(m)) return LARGE_LOCAL_BUDGET;
    return SMALL_LOCAL_BUDGET;
  }
  return DISABLED_BUDGET;
}
