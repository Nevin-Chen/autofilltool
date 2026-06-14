import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  emptyProfile,
  type AiSettings,
  type ExemplarAnswer,
  type VoiceSample,
} from '@/profile/schema';
import { collectVoiceContext } from '@/ai/voice-context';

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return { ...defaultSettings().ai, ...overrides };
}

function sample(body: string, createdAt = '2026-06-01T00:00:00.000Z'): VoiceSample {
  return {
    id: crypto.randomUUID(),
    body,
    createdAt,
  };
}

function exemplar(
  questionPattern: string,
  answer: string,
  favorite = false,
): ExemplarAnswer {
  return {
    id: crypto.randomUUID(),
    questionPattern,
    answer,
    updatedAt: '2026-06-01T00:00:00.000Z',
    favorite,
  };
}

describe('collectVoiceContext: voice samples (US1)', () => {
  it('returns empty arrays for an empty profile on a cloud provider', () => {
    const profile = emptyProfile();
    const ctx = collectVoiceContext(
      profile,
      'Why this role?',
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    expect(ctx.voiceSamples).toEqual([]);
    expect(ctx.exemplars).toEqual([]);
    expect(ctx.budgetReport.samplesShipped).toBe(0);
    expect(ctx.budgetReport.samplesSkipped).toBe(0);
  });

  it('ships all samples in createdAt order when total fits the cloud budget', () => {
    const profile = emptyProfile();
    profile.voiceSamples = [
      sample('B'.repeat(800), '2026-06-02T00:00:00.000Z'),
      sample('A'.repeat(800), '2026-06-01T00:00:00.000Z'),
      sample('C'.repeat(800), '2026-06-03T00:00:00.000Z'),
    ];
    const ctx = collectVoiceContext(
      profile,
      'Tell us about yourself',
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    expect(ctx.voiceSamples.map((s) => s.body[0])).toEqual(['A', 'B', 'C']);
    expect(ctx.budgetReport.voiceCharsUsed).toBe(2400);
    expect(ctx.budgetReport.samplesShipped).toBe(3);
    expect(ctx.budgetReport.samplesSkipped).toBe(0);
  });

  it('drops over-budget samples whole; never truncates mid-item', () => {
    const profile = emptyProfile();
    profile.voiceSamples = [
      sample('A'.repeat(2000), '2026-06-01T00:00:00.000Z'),
      sample('B'.repeat(2000), '2026-06-02T00:00:00.000Z'),
      sample('C'.repeat(2000), '2026-06-03T00:00:00.000Z'),
      sample('D'.repeat(2000), '2026-06-04T00:00:00.000Z'),
    ];
    const ctx = collectVoiceContext(
      profile,
      'q',
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    expect(ctx.voiceSamples).toHaveLength(3);
    expect(ctx.budgetReport.voiceCharsUsed).toBe(6000);
    expect(ctx.budgetReport.samplesSkipped).toBe(1);
    for (const s of ctx.voiceSamples) {
      expect(s.body.length).toBe(2000);
    }
  });

  it('ships only 2 of 3 samples on the small Ollama budget (1200-char cap)', () => {
    const profile = emptyProfile();
    profile.voiceSamples = [
      sample('a'.repeat(600), '2026-06-01T00:00:00.000Z'),
      sample('b'.repeat(600), '2026-06-02T00:00:00.000Z'),
      sample('c'.repeat(600), '2026-06-03T00:00:00.000Z'),
    ];
    const ctx = collectVoiceContext(
      profile,
      'q',
      settings({ provider: 'ollama', model: 'llama3.2' }),
    );
    expect(ctx.voiceSamples).toHaveLength(2);
    expect(ctx.budgetReport.voiceCharsUsed).toBe(1200);
    expect(ctx.budgetReport.samplesSkipped).toBe(1);
  });

  it('returns empty when provider is "none" (FR-016 fallthrough)', () => {
    const profile = emptyProfile();
    profile.voiceSamples = [sample('voice'.repeat(50))];
    const ctx = collectVoiceContext(
      profile,
      'q',
      settings({ provider: 'none', model: '' }),
    );
    expect(ctx.voiceSamples).toEqual([]);
    expect(ctx.exemplars).toEqual([]);
    expect(ctx.budgetReport.voiceCharBudget).toBe(0);
  });
});

describe('collectVoiceContext: exemplars (US2)', () => {
  const question = 'Why this role?';

  it('returns no exemplars when none are saved', () => {
    const profile = emptyProfile();
    const ctx = collectVoiceContext(
      profile,
      question,
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    expect(ctx.exemplars).toEqual([]);
  });

  it('selects related exemplars and excludes unrelated ones', () => {
    const profile = emptyProfile();
    profile.savedAnswers = [
      exemplar(
        'Why this role?',
        'Because the role aligns with what I want to do next.',
      ),
      exemplar(
        'Why this company?',
        'Because the company is doing X that matches my interests.',
      ),
      exemplar(
        'What is your desired salary?',
        'I am flexible based on the full package.',
      ),
    ];
    const ctx = collectVoiceContext(
      profile,
      'Why this role?',
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    const patterns = ctx.exemplars.map((e) => e.questionPattern);
    expect(patterns).toContain('Why this role?');
    expect(patterns).not.toContain('What is your desired salary?');
    expect(ctx.exemplars.length).toBeLessThanOrEqual(2);
  });

  it('honors maxExemplars (Ollama default: 1)', () => {
    const profile = emptyProfile();
    profile.savedAnswers = [
      exemplar('Why this role?', 'A'.repeat(100)),
      exemplar('Why this role here?', 'B'.repeat(100)),
      exemplar('Why this role specifically?', 'C'.repeat(100)),
    ];
    const ctx = collectVoiceContext(
      profile,
      'Why this role?',
      settings({ provider: 'ollama', model: 'llama3.2' }),
    );
    expect(ctx.exemplars).toHaveLength(1);
  });

  it('favorite tie-break: equal-score favorite ranks above non-favorite', () => {
    const profile = emptyProfile();
    profile.savedAnswers = [
      exemplar('Why this role?', 'Plain answer body.', false),
      exemplar('Why this role?', 'Favorite answer body.', true),
    ];
    const ctx = collectVoiceContext(
      profile,
      'Why this role?',
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    expect(ctx.exemplars[0]!.favorite).toBe(true);
  });

  it('honors exemplarCharBudget; drops the cheaper-scoring item if it would overflow', () => {
    const profile = emptyProfile();
    profile.savedAnswers = [
      exemplar('Why this role?', 'x'.repeat(2500)),
      exemplar('Why this role here?', 'y'.repeat(2500)),
    ];
    const ctx = collectVoiceContext(
      profile,
      'Why this role?',
      settings({ provider: 'openai', model: 'gpt-4o-mini' }),
    );
    expect(ctx.exemplars).toHaveLength(1);
    expect(ctx.budgetReport.exemplarCharsUsed).toBeLessThanOrEqual(4000);
  });
});
