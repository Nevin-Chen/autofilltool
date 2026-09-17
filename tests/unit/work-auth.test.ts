import { describe, expect, it } from 'vitest';
import { workAuthAnswerFromLabel, isWorkEligibilityQuestion } from '@/lib/work-auth';
import type { WorkAuth } from '@/profile/schema';

const NO_SPONSORSHIP: WorkAuth = {
  authorizedToWorkInUS: true,
  requiresSponsorship: false,
  willingToRelocate: null,
  noticePeriodWeeks: null,
  desiredSalary: '',
};

const NEEDS_SPONSORSHIP: WorkAuth = {
  ...NO_SPONSORSHIP,
  authorizedToWorkInUS: false,
  requiresSponsorship: true,
};

const UNSET: WorkAuth = {
  ...NO_SPONSORSHIP,
  authorizedToWorkInUS: null,
  requiresSponsorship: null,
};

describe('workAuthAnswerFromLabel — "do you require sponsorship" phrasing', () => {
  const labels = [
    'Will you now or in the future require sponsorship for employment visa status?',
    'Do you now, or will you in the future, require sponsorship to work in the U.S.?',
    'Will you require visa sponsorship now or in the future?',
    'Do you require sponsorship to work in the United States?',
    'Will you now or in the future require immigration sponsorship?',
    'Does your employment require visa sponsorship?',
  ];

  for (const label of labels) {
    it(`answers No when the profile says no sponsorship: "${label}"`, () => {
      expect(workAuthAnswerFromLabel(label, NO_SPONSORSHIP)).toBe('No');
    });

    it(`answers Yes when the profile says sponsorship is needed: "${label}"`, () => {
      expect(workAuthAnswerFromLabel(label, NEEDS_SPONSORSHIP)).toBe('Yes');
    });
  }
});

describe('workAuthAnswerFromLabel — inverted "without sponsorship" phrasing', () => {
  const labels = [
    'Are you legally authorized to work in the United States without sponsorship?',
    'Are you authorized to work lawfully in the US without requiring visa sponsorship?',
    'Can you work in the United States without requiring sponsorship now or in the future?',
    'Are you able to work without needing visa sponsorship?',
  ];

  for (const label of labels) {
    it(`flips to Yes when the profile says no sponsorship: "${label}"`, () => {
      expect(workAuthAnswerFromLabel(label, NO_SPONSORSHIP)).toBe('Yes');
    });

    it(`flips to No when the profile says sponsorship is needed: "${label}"`, () => {
      expect(workAuthAnswerFromLabel(label, NEEDS_SPONSORSHIP)).toBe('No');
    });
  }
});

describe('workAuthAnswerFromLabel — plain authorization phrasing', () => {
  it('answers from authorizedToWorkInUS', () => {
    const label = 'Are you legally authorized to work in the United States?';
    expect(workAuthAnswerFromLabel(label, NO_SPONSORSHIP)).toBe('Yes');
    expect(workAuthAnswerFromLabel(label, NEEDS_SPONSORSHIP)).toBe('No');
  });

  it('reads "eligible to work" and "right to work" as the same question', () => {
    expect(
      workAuthAnswerFromLabel('Are you eligible to work in the UK?', NO_SPONSORSHIP),
    ).toBe('Yes');
    expect(
      workAuthAnswerFromLabel('Do you have the right to work in Canada?', NO_SPONSORSHIP),
    ).toBe('Yes');
  });
});

describe('workAuthAnswerFromLabel — employer statements never flip the answer', () => {
  it('ignores "we do not offer sponsorship" preamble', () => {
    const label =
      'This role does not offer visa sponsorship. Will you require sponsorship now or in the future?';
    expect(workAuthAnswerFromLabel(label, NO_SPONSORSHIP)).toBe('No');
    expect(workAuthAnswerFromLabel(label, NEEDS_SPONSORSHIP)).toBe('Yes');
  });

  it('ignores a parenthetical about the company not sponsoring', () => {
    const label =
      'Will you now or in the future require sponsorship? (We are unable to sponsor visas.)';
    expect(workAuthAnswerFromLabel(label, NO_SPONSORSHIP)).toBe('No');
  });
});

describe('workAuthAnswerFromLabel — defers rather than guessing', () => {
  it('returns null when the profile has no saved answer', () => {
    expect(
      workAuthAnswerFromLabel('Will you require visa sponsorship?', UNSET),
    ).toBeNull();
    expect(
      workAuthAnswerFromLabel('Are you authorized to work in the US?', UNSET),
    ).toBeNull();
  });

  it('returns null for questions it cannot map to a saved boolean', () => {
    expect(workAuthAnswerFromLabel('What is your visa type?', NO_SPONSORSHIP)).toBeNull();
    expect(
      workAuthAnswerFromLabel('Are you a US citizen or permanent resident?', NO_SPONSORSHIP),
    ).toBeNull();
    expect(workAuthAnswerFromLabel('How did you hear about us?', NO_SPONSORSHIP)).toBeNull();
  });
});

describe('isWorkEligibilityQuestion', () => {
  it('covers sponsorship and authorization wording', () => {
    expect(isWorkEligibilityQuestion('Will you require visa sponsorship?')).toBe(true);
    expect(isWorkEligibilityQuestion('Are you authorized to work in the US?')).toBe(true);
    expect(isWorkEligibilityQuestion('What is your visa type?')).toBe(true);
  });

  it('leaves ordinary questions alone', () => {
    expect(isWorkEligibilityQuestion('How did you hear about us?')).toBe(false);
    expect(isWorkEligibilityQuestion('Earliest start date')).toBe(false);
  });
});
