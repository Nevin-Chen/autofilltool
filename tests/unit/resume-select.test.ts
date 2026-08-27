import { describe, it, expect } from 'vitest';
import {
  companyKeyFromUrl,
  defaultVariant,
  pruneCompanyChoices,
  resolveResumeVariant,
  variantById,
  withCompanyChoice,
} from '@/profile/resume-select';
import type { ResumeLibrary, ResumeVariant } from '@/profile/schema';

function variant(id: string, label: string): ResumeVariant {
  return {
    id,
    label,
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    size: 1024,
    bytesBase64: 'AAAA',
    uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  };
}

function library(activeId: string | null, ...variants: ResumeVariant[]): ResumeLibrary {
  return { variants, activeId };
}

describe('companyKeyFromUrl', () => {
  it('keys shared ATS hosts by the company path segment', () => {
    expect(companyKeyFromUrl('https://job-boards.greenhouse.io/stripe/jobs/4567')).toBe(
      'job-boards.greenhouse.io/stripe',
    );
    expect(companyKeyFromUrl('https://jobs.lever.co/ramp/8f2c-uuid/apply')).toBe(
      'jobs.lever.co/ramp',
    );
    expect(companyKeyFromUrl('https://jobs.ashbyhq.com/ramp/8f2c-uuid/application')).toBe(
      'jobs.ashbyhq.com/ramp',
    );
  });

  it('gives two postings at the same company the same key', () => {
    expect(companyKeyFromUrl('https://job-boards.greenhouse.io/stripe/jobs/1')).toBe(
      companyKeyFromUrl('https://job-boards.greenhouse.io/stripe/jobs/2'),
    );
  });

  it('reads the company out of a legacy Greenhouse embed query', () => {
    expect(
      companyKeyFromUrl('https://boards.greenhouse.io/embed/job_app?for=stripe&token=9'),
    ).toBe('boards.greenhouse.io/stripe');
  });

  it('falls back to the host when an embed URL has no company', () => {
    expect(companyKeyFromUrl('https://boards.greenhouse.io/embed/job_app?token=9')).toBe(
      'boards.greenhouse.io',
    );
  });

  it('keys company-specific hosts by host alone', () => {
    expect(
      companyKeyFromUrl('https://stripe.wd1.myworkdayjobs.com/en-US/Careers/job/x'),
    ).toBe('stripe.wd1.myworkdayjobs.com');
    expect(companyKeyFromUrl('https://ramp.applytojob.com/apply/abc')).toBe(
      'ramp.applytojob.com',
    );
    expect(companyKeyFromUrl('https://www.careers.stripe.com/jobs/1')).toBe(
      'careers.stripe.com',
    );
  });

  it('returns an empty key for URLs that cannot identify a company', () => {
    expect(companyKeyFromUrl('chrome://extensions')).toBe('');
    expect(companyKeyFromUrl('not a url')).toBe('');
    expect(companyKeyFromUrl('')).toBe('');
  });
});

describe('resolveResumeVariant', () => {
  const backend = variant('a', 'Backend');
  const ml = variant('b', 'ML');
  const lib = library('a', backend, ml);

  it('prefers the company choice over the default', () => {
    const picked = resolveResumeVariant(lib, { 'jobs.lever.co/ramp': 'b' }, 'jobs.lever.co/ramp');
    expect(picked?.id).toBe('b');
  });

  it('falls back to the default for a company with no choice', () => {
    expect(resolveResumeVariant(lib, {}, 'jobs.lever.co/ramp')?.id).toBe('a');
  });

  it('falls back to the default when the choice names a deleted variant', () => {
    const picked = resolveResumeVariant(lib, { 'jobs.lever.co/ramp': 'gone' }, 'jobs.lever.co/ramp');
    expect(picked?.id).toBe('a');
  });

  it('falls back to the first variant when no default is set', () => {
    expect(resolveResumeVariant(library(null, backend, ml), {}, '')?.id).toBe('a');
  });

  it('returns null for an empty library', () => {
    expect(resolveResumeVariant(library(null), {}, 'jobs.lever.co/ramp')).toBeNull();
  });

  it('ignores choices when the company key is empty', () => {
    expect(resolveResumeVariant(lib, { '': 'b' }, '')?.id).toBe('a');
  });
});

describe('variantById / defaultVariant', () => {
  const lib = library('b', variant('a', 'Backend'), variant('b', 'ML'));

  it('looks a variant up by id', () => {
    expect(variantById(lib, 'b')?.label).toBe('ML');
    expect(variantById(lib, 'nope')).toBeNull();
    expect(variantById(lib, null)).toBeNull();
  });

  it('resolves the default, falling back to the first variant', () => {
    expect(defaultVariant(lib)?.id).toBe('b');
    expect(defaultVariant(library('gone', variant('a', 'Backend')))?.id).toBe('a');
    expect(defaultVariant(library(null))).toBeNull();
  });
});

describe('withCompanyChoice', () => {
  const lib = library('a', variant('a', 'Backend'), variant('b', 'ML'));

  it('pins a non-default variant to the company', () => {
    expect(withCompanyChoice({}, 'jobs.lever.co/ramp', 'b', lib)).toEqual({
      'jobs.lever.co/ramp': 'b',
    });
  });

  it('clears the entry when the pick matches the default', () => {
    const choices = { 'jobs.lever.co/ramp': 'b' };
    expect(withCompanyChoice(choices, 'jobs.lever.co/ramp', 'a', lib)).toEqual({});
  });

  it('leaves other companies alone', () => {
    const choices = { 'jobs.ashbyhq.com/notion': 'b' };
    expect(withCompanyChoice(choices, 'jobs.lever.co/ramp', 'b', lib)).toEqual({
      'jobs.ashbyhq.com/notion': 'b',
      'jobs.lever.co/ramp': 'b',
    });
  });

  it('is a no-op without a company key', () => {
    expect(withCompanyChoice({ x: 'b' }, '', 'b', lib)).toEqual({ x: 'b' });
  });
});

describe('pruneCompanyChoices', () => {
  it('drops choices pointing at removed variants', () => {
    const lib = library('a', variant('a', 'Backend'));
    expect(
      pruneCompanyChoices({ 'jobs.lever.co/ramp': 'b', 'careers.stripe.com': 'a' }, lib),
    ).toEqual({ 'careers.stripe.com': 'a' });
  });
});
