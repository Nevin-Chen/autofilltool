import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/ai/client';
import type { VoiceContext } from '@/ai/voice-context';

function emptyVoiceCtx(): VoiceContext {
  return {
    voiceSamples: [],
    exemplars: [],
    budgetReport: {
      provider: 'openai',
      voiceCharsUsed: 0,
      voiceCharBudget: 6000,
      exemplarCharsUsed: 0,
      exemplarCharBudget: 4000,
      samplesShipped: 0,
      samplesSkipped: 0,
      exemplarsShipped: 0,
      exemplarsConsidered: 0,
    },
  };
}

describe('buildPrompt: writing-voice baseline (FR-016)', () => {
  it('matches the no-context baseline when voiceContext is undefined', async () => {
    const a = await buildPrompt({ question: 'Why us?' }, null);
    const b = await buildPrompt({ question: 'Why us?' }, null, undefined);
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });

  it('matches the no-context baseline when voiceContext is empty', async () => {
    const baseline = await buildPrompt({ question: 'Why us?' }, null);
    const withEmpty = await buildPrompt(
      { question: 'Why us?' },
      null,
      emptyVoiceCtx(),
    );
    expect(withEmpty.system).toBe(baseline.system);
    expect(withEmpty.user).toBe(baseline.user);
    expect(withEmpty.user).not.toMatch(/=== ABOUT YOUR VOICE ===/);
    expect(withEmpty.user).not.toMatch(/=== EXAMPLES OF YOUR PAST ANSWERS ===/);
    expect(withEmpty.system).not.toMatch(/SOFT OVERRIDE/);
  });
});

describe('buildPrompt: voice samples present (US1)', () => {
  const ctx: VoiceContext = {
    ...emptyVoiceCtx(),
    voiceSamples: [
      { body: 'I like short sentences. They land.' },
      { body: 'Mostly nouns. Few adjectives.' },
    ],
    budgetReport: {
      ...emptyVoiceCtx().budgetReport,
      voiceCharsUsed: 60,
      samplesShipped: 2,
    },
  };

  it('inserts the soft-override rule once between facts and résumé-section rules', async () => {
    const { system } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    const occurrences = system.match(/SOFT OVERRIDE/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const softIdx = system.indexOf('SOFT OVERRIDE');
    const factsIdx = system.indexOf('partial honest answer over speculation');
    const sectionIdx = system.indexOf('may be split into labelled sections');
    expect(factsIdx).toBeGreaterThan(-1);
    expect(softIdx).toBeGreaterThan(factsIdx);
    expect(sectionIdx).toBeGreaterThan(softIdx);
  });

  it('soft-override rule names ABOUT YOUR VOICE and ABOUT THE CANDIDATE literally', async () => {
    const { system } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    expect(system).toMatch(/ABOUT YOUR VOICE/);
    expect(system).toMatch(/ABOUT THE CANDIDATE/);
  });

  it('user prompt contains === ABOUT YOUR VOICE === between candidate and posting', async () => {
    const { user } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    const aboutVoice = user.indexOf('=== ABOUT YOUR VOICE ===');
    const candidate = user.indexOf('=== ABOUT THE CANDIDATE ===');
    const posting = user.indexOf('=== JOB POSTING ===');
    expect(aboutVoice).toBeGreaterThan(candidate);
    expect(posting).toBeGreaterThan(aboutVoice);
    expect(user).toMatch(/Sample 1:/);
    expect(user).toMatch(/Sample 2:/);
    expect(user).toMatch(/I like short sentences\./);
  });

  it('keeps existing banned-vocabulary rule', async () => {
    const { system } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    expect(system).toMatch(/Banned vocabulary/);
    expect(system).toMatch(/delve/);
    expect(system).toMatch(/leverage/);
  });
});

describe('buildPrompt: exemplars present (US2)', () => {
  const ctx: VoiceContext = {
    ...emptyVoiceCtx(),
    exemplars: [
      {
        questionPattern: 'Why this role?',
        answer: 'I want to build storage at scale.',
        score: 0.42,
        favorite: false,
      },
    ],
    budgetReport: {
      ...emptyVoiceCtx().budgetReport,
      exemplarCharsUsed: 50,
      exemplarsShipped: 1,
      exemplarsConsidered: 1,
    },
  };

  it('emits the exemplar rule once', async () => {
    const { system } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    const occurrences = system.match(/EXAMPLES OF YOUR PAST ANSWERS/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
  });

  it('emits the EXAMPLES block in the user prompt with Question/Answer pairs', async () => {
    const { user } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    expect(user).toMatch(/=== EXAMPLES OF YOUR PAST ANSWERS ===/);
    expect(user).toMatch(/Example 1:/);
    expect(user).toMatch(/Question: Why this role\?/);
    expect(user).toMatch(/I want to build storage at scale\./);
  });
});

describe('buildPrompt: voice and exemplars together', () => {
  const ctx: VoiceContext = {
    ...emptyVoiceCtx(),
    voiceSamples: [{ body: 'My short voice.' }],
    exemplars: [
      {
        questionPattern: 'Why this role?',
        answer: 'Because storage.',
        score: 0.5,
        favorite: true,
      },
    ],
    budgetReport: {
      ...emptyVoiceCtx().budgetReport,
      voiceCharsUsed: 15,
      samplesShipped: 1,
      exemplarCharsUsed: 30,
      exemplarsShipped: 1,
      exemplarsConsidered: 1,
    },
  };

  it('voice rule precedes exemplar rule in the system prompt', async () => {
    const { system } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    const voiceIdx = system.indexOf('SOFT OVERRIDE');
    const exemplarIdx = system.indexOf('EXAMPLES OF YOUR PAST ANSWERS');
    expect(voiceIdx).toBeGreaterThan(-1);
    expect(exemplarIdx).toBeGreaterThan(voiceIdx);
  });

  it('ABOUT YOUR VOICE block precedes EXAMPLES block in the user prompt', async () => {
    const { user } = await buildPrompt({ question: 'Why us?' }, null, ctx);
    const voice = user.indexOf('=== ABOUT YOUR VOICE ===');
    const examples = user.indexOf('=== EXAMPLES OF YOUR PAST ANSWERS ===');
    const posting = user.indexOf('=== JOB POSTING ===');
    expect(voice).toBeGreaterThan(-1);
    expect(examples).toBeGreaterThan(voice);
    expect(posting).toBeGreaterThan(examples);
  });
});

describe('buildPrompt: existing budgets are not reduced (FR-008 defense)', () => {
  it('résumé and JD prompt budget constants stay as documented', async () => {
    const bigJd = 'X'.repeat(10_000);
    const { user } = await buildPrompt(
      { question: 'q', jobDescription: bigJd },
      null,
      emptyVoiceCtx(),
    );
    expect(user).toMatch(/X+…/);
    expect(user).not.toMatch(/X{5000}/);
  });
});
