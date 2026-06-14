import { describe, expect, it } from 'vitest';
import {
  EXEMPLAR_SIM_THRESHOLD,
  FAVORITE_SCORE_BOOST,
  normalize,
  scoreExemplar,
} from '@/ai/voice-similarity';

describe('normalize', () => {
  it('lowercases, strips punctuation, drops short tokens and stopwords', () => {
    expect(normalize('Why this company?')).toEqual(['why', 'company']);
    expect(normalize('Tell us about a time you led')).toEqual(['tell', 'about', 'time', 'led']);
  });

  it('returns [] for the empty string', () => {
    expect(normalize('')).toEqual([]);
  });
});

describe('scoreExemplar', () => {
  it('produces ~0.33 on the calibrated "Why this role / Why this company" pair', () => {
    const s = scoreExemplar('Why this company?', 'Why this role?');
    expect(s).toBeGreaterThanOrEqual(0.33);
    expect(s).toBeLessThan(0.5);
    expect(s).toBeGreaterThan(EXEMPLAR_SIM_THRESHOLD);
  });

  it('returns 0 for unrelated questions', () => {
    expect(scoreExemplar('Why this company?', 'What is your desired salary?')).toBe(0);
  });

  it('returns 1.0 for identical normalized inputs', () => {
    expect(scoreExemplar('Tell us about a team challenge', 'Tell us about a team challenge')).toBe(1);
  });

  it('is symmetric', () => {
    const a = scoreExemplar('Why this role?', 'Why this company?');
    const b = scoreExemplar('Why this company?', 'Why this role?');
    expect(a).toBe(b);
  });

  it('favorite boost lifts the score by exactly +0.05', () => {
    const plain = scoreExemplar('Why this company?', 'Why this role?', false);
    const fav = scoreExemplar('Why this company?', 'Why this role?', true);
    expect(fav - plain).toBeCloseTo(FAVORITE_SCORE_BOOST, 10);
  });

  it('is deterministic across many invocations', () => {
    const a = scoreExemplar('Tell us about a time you led a team', 'Describe a time you led');
    for (let i = 0; i < 1000; i++) {
      expect(scoreExemplar('Tell us about a time you led a team', 'Describe a time you led')).toBe(a);
    }
  });

  it('threshold of 0.18 is exported and stable', () => {
    expect(EXEMPLAR_SIM_THRESHOLD).toBe(0.18);
  });
});
