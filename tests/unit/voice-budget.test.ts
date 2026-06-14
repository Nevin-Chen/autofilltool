import { describe, expect, it } from 'vitest';
import { budgetForProvider } from '@/ai/voice-budget';

describe('budgetForProvider', () => {
  it('cloud providers all share the generous budget', () => {
    const expected = { voiceCharBudget: 6000, exemplarCharBudget: 4000, maxExemplars: 2 };
    expect(budgetForProvider('openai', 'gpt-4o-mini')).toEqual(expected);
    expect(budgetForProvider('anthropic', 'claude-sonnet-4-6')).toEqual(expected);
    expect(budgetForProvider('gemini', 'gemini-2.5-flash')).toEqual(expected);
  });

  it('default ollama (llama3.2 / 3B class) gets the tight budget', () => {
    expect(budgetForProvider('ollama', 'llama3.2')).toEqual({
      voiceCharBudget: 1200,
      exemplarCharBudget: 1200,
      maxExemplars: 1,
    });
    expect(budgetForProvider('ollama', '')).toEqual({
      voiceCharBudget: 1200,
      exemplarCharBudget: 1200,
      maxExemplars: 1,
    });
  });

  it('large local ollama models earn a roomier budget', () => {
    const expected = { voiceCharBudget: 4000, exemplarCharBudget: 3000, maxExemplars: 2 };
    expect(budgetForProvider('ollama', 'qwen2.5:7b')).toEqual(expected);
    expect(budgetForProvider('ollama', 'qwen3')).toEqual(expected);
    expect(budgetForProvider('ollama', 'llama3.1')).toEqual(expected);
    expect(budgetForProvider('ollama', 'llama3.3')).toEqual(expected);
    expect(budgetForProvider('ollama', 'mistral-nemo')).toEqual(expected);
  });

  it('ollama with a 7B/8B/13B/14B tag matches the large-local row', () => {
    const expected = { voiceCharBudget: 4000, exemplarCharBudget: 3000, maxExemplars: 2 };
    expect(budgetForProvider('ollama', 'custom-model:7b')).toEqual(expected);
    expect(budgetForProvider('ollama', 'custom-model:8b')).toEqual(expected);
    expect(budgetForProvider('ollama', 'custom-model:13b')).toEqual(expected);
    expect(budgetForProvider('ollama', 'custom-model:14b')).toEqual(expected);
  });

  it('provider "none" yields zero budget', () => {
    expect(budgetForProvider('none', '')).toEqual({
      voiceCharBudget: 0,
      exemplarCharBudget: 0,
      maxExemplars: 0,
    });
  });

  it('is deterministic for the same inputs', () => {
    expect(budgetForProvider('openai', 'gpt-4o-mini')).toEqual(
      budgetForProvider('openai', 'gpt-4o-mini'),
    );
    expect(budgetForProvider('ollama', 'qwen2.5:7b')).toEqual(
      budgetForProvider('ollama', 'qwen2.5:7b'),
    );
  });
});
