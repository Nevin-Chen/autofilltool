import { describe, expect, it } from 'vitest';
import {
  ExemplarAnswerSchema,
  ProfileSchema,
  SavedAnswerSchema,
  VoiceSampleSchema,
  VOICE_SAMPLE_MAX_CHARS,
  EXEMPLAR_ANSWER_MAX_CHARS,
  emptyProfile,
} from '@/profile/schema';
import { migrateProfile } from '@/profile/migrations';

const SAMPLE_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_CREATED = new Date('2026-06-13T12:00:00Z').toISOString();

function validVoiceSample(body: string) {
  return { id: SAMPLE_ID, body, createdAt: SAMPLE_CREATED };
}

function validExemplar(
  answer: string,
  extra: Partial<{ favorite: boolean; questionPattern: string }> = {},
) {
  return {
    id: SAMPLE_ID,
    questionPattern: extra.questionPattern ?? 'Why this company?',
    answer,
    updatedAt: SAMPLE_CREATED,
    ...(extra.favorite !== undefined ? { favorite: extra.favorite } : {}),
  };
}

describe('VoiceSampleSchema', () => {
  it('exposes a 3000-char cap constant', () => {
    expect(VOICE_SAMPLE_MAX_CHARS).toBe(3000);
  });

  it('accepts a 1-char body', () => {
    expect(VoiceSampleSchema.safeParse(validVoiceSample('a')).success).toBe(true);
  });

  it('accepts a 3000-char body', () => {
    const body = 'x'.repeat(3000);
    expect(VoiceSampleSchema.safeParse(validVoiceSample(body)).success).toBe(true);
  });

  it('rejects an empty body', () => {
    const r = VoiceSampleSchema.safeParse(validVoiceSample(''));
    expect(r.success).toBe(false);
  });

  it('rejects a 3001-char body', () => {
    const body = 'x'.repeat(3001);
    const r = VoiceSampleSchema.safeParse(validVoiceSample(body));
    expect(r.success).toBe(false);
  });
});

describe('ExemplarAnswerSchema', () => {
  it('exposes a 3000-char cap constant', () => {
    expect(EXEMPLAR_ANSWER_MAX_CHARS).toBe(3000);
  });

  it('accepts answers between 1 and 3000 chars with optional favorite', () => {
    expect(ExemplarAnswerSchema.safeParse(validExemplar('Short answer')).success).toBe(true);
    expect(
      ExemplarAnswerSchema.safeParse(validExemplar('x'.repeat(3000))).success,
    ).toBe(true);
    expect(
      ExemplarAnswerSchema.safeParse(validExemplar('Yes', { favorite: true })).success,
    ).toBe(true);
  });

  it('rejects empty answer', () => {
    expect(ExemplarAnswerSchema.safeParse(validExemplar('')).success).toBe(false);
  });

  it('rejects 3001-char answer', () => {
    expect(
      ExemplarAnswerSchema.safeParse(validExemplar('x'.repeat(3001))).success,
    ).toBe(false);
  });

  it('SavedAnswerSchema is an alias for backward compat', () => {
    expect(SavedAnswerSchema).toBe(ExemplarAnswerSchema);
  });
});

describe('Profile v2 → v3 migration', () => {
  it('adds voiceSamples: [] to a v2-shaped profile, preserves savedAnswers', () => {
    const v2: Record<string, unknown> = {
      ...emptyProfile(),
      savedAnswers: [validExemplar('keep me')],
    };
    delete (v2 as Record<string, unknown>).voiceSamples;
    const migrated = migrateProfile(v2, 2);
    expect(migrated.voiceSamples).toEqual([]);
    expect(migrated.savedAnswers).toHaveLength(1);
    expect(migrated.savedAnswers[0]!.answer).toBe('keep me');
  });

  it('is idempotent on a v3 record', () => {
    const v3 = emptyProfile();
    v3.voiceSamples = [validVoiceSample('already here')];
    const once = migrateProfile(v3, 3);
    const twice = migrateProfile(once, 3);
    expect(once).toEqual(twice);
    expect(once.voiceSamples).toHaveLength(1);
    expect(once.voiceSamples[0]!.body).toBe('already here');
  });

  it('emptyProfile() returns voiceSamples: []', () => {
    expect(emptyProfile().voiceSamples).toEqual([]);
  });
});

describe('ProfileSchema voiceSamples field', () => {
  it('parses with voice samples present', () => {
    const p = emptyProfile();
    p.voiceSamples = [validVoiceSample('hi')];
    const r = ProfileSchema.safeParse(p);
    expect(r.success).toBe(true);
  });

  it('rejects a profile carrying an over-cap voice sample', () => {
    const p: Record<string, unknown> = {
      ...emptyProfile(),
      voiceSamples: [validVoiceSample('x'.repeat(3001))],
    };
    const r = ProfileSchema.safeParse(p);
    expect(r.success).toBe(false);
  });
});
