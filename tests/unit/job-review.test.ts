import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_CHAR_BUDGET,
  buildReviewPrompt,
  evidenceIsVerified,
  finalizeReview,
  parseReviewResponse,
  type RawReview,
} from '@/jobs/review';
import type { JobFeedback } from '@/jobs/schema';
import { listing } from './job-fixtures';

const RESUME = [
  'Software Engineer, Stripe (remote)',
  '● Migrated internal sales tools from jQuery to React, cutting order processing time by 20%.',
  '● Developed microservices tracking 10,000+ orders/month via REST APIs.',
  'Skills: TypeScript, Ruby on Rails, PostgreSQL, Docker',
].join('\n');

const context = {
  profileSummary: 'Brooklyn, NY. 2.5 years as a software engineer.',
  resumeText: RESUME,
  disagreements: [] as JobFeedback[],
};

function raw(overrides: Partial<RawReview> = {}): RawReview {
  return {
    requirements: [
      { text: 'React', importance: 'must', status: 'met', evidence: 'Migrated internal sales tools from jQuery to React' },
      { text: 'REST APIs', importance: 'must', status: 'met', evidence: 'microservices tracking 10,000+ orders/month via REST APIs' },
      { text: 'GraphQL', importance: 'nice', status: 'missing', evidence: '' },
    ],
    yearsAsked: 2,
    flags: ['Hybrid in New York City'],
    verdict: 'strong',
    confidence: 'high',
    summary: 'React and REST work line up; GraphQL is the gap.',
    ...overrides,
  };
}

describe('buildReviewPrompt', () => {
  it('sends the full posting with the job facts and the candidate block', () => {
    const { user } = buildReviewPrompt(
      { listing: listing(), description: 'You will build payment APIs in TypeScript.', descriptionSource: 'full' },
      context,
    );
    expect(user).toContain('Description (the full posting):');
    expect(user).toContain('You will build payment APIs in TypeScript.');
    expect(user).toContain('Title: Software Engineer, Payments');
    expect(user).toContain('Company: Stripe');
    expect(user).toContain(RESUME);
    expect(user).not.toMatch(/criteria/i);
  });

  it('says when only the board summary was available', () => {
    const { user } = buildReviewPrompt(
      { listing: listing(), description: 'Short summary.', descriptionSource: 'summary' },
      context,
    );
    expect(user).toMatch(/only the job board's short summary/);
  });

  it(`caps the description at ${DESCRIPTION_CHAR_BUDGET} characters`, () => {
    const { user } = buildReviewPrompt(
      { listing: listing(), description: 'x'.repeat(DESCRIPTION_CHAR_BUDGET + 500), descriptionSource: 'full' },
      context,
    );
    expect(user).toContain('x'.repeat(DESCRIPTION_CHAR_BUDGET));
    expect(user).not.toContain('x'.repeat(DESCRIPTION_CHAR_BUDGET + 1));
  });

  it('asks for word-for-word résumé quotes', () => {
    const { system } = buildReviewPrompt(
      { listing: listing(), description: 'd', descriptionSource: 'full' },
      context,
    );
    expect(system).toMatch(/word for word/);
    expect(system).toMatch(/only a JSON object/);
  });
});

describe('parseReviewResponse', () => {
  it('reads a JSON object wrapped in a code fence', () => {
    const parsed = parseReviewResponse(`\`\`\`json\n${JSON.stringify(raw())}\n\`\`\``);
    expect(parsed?.verdict).toBe('strong');
    expect(parsed?.requirements).toHaveLength(3);
  });

  it('defaults loose fields instead of throwing the review away', () => {
    const parsed = parseReviewResponse(
      JSON.stringify({ verdict: 'maybe', confidence: 'very', yearsAsked: 'three', requirements: [{ text: 'Go', importance: 'core', status: 'missing' }] }),
    );
    expect(parsed).toMatchObject({ verdict: 'maybe', confidence: 'medium', yearsAsked: null, flags: [], summary: '' });
    expect(parsed?.requirements[0]).toEqual({ text: 'Go', importance: 'must', status: 'missing', evidence: '' });
  });

  it('returns null without a usable verdict', () => {
    expect(parseReviewResponse('{"verdict": "excellent"}')).toBeNull();
    expect(parseReviewResponse('No JSON here.')).toBeNull();
  });
});

describe('evidenceIsVerified', () => {
  it('finds a quote despite case, curly quotes, bullets and line breaks', () => {
    expect(evidenceIsVerified('MIGRATED internal sales tools\nfrom jQuery to React.', RESUME)).toBe(true);
    expect(evidenceIsVerified('“Ruby on Rails, PostgreSQL”', RESUME)).toBe(true);
  });

  it('rejects a paraphrase or an invented line', () => {
    expect(evidenceIsVerified('Rewrote the sales tools in React', RESUME)).toBe(false);
    expect(evidenceIsVerified('Led a team of 8 engineers', RESUME)).toBe(false);
    expect(evidenceIsVerified('', RESUME)).toBe(false);
  });
});

describe('finalizeReview', () => {
  it('keeps a strong verdict when every must-have quote is in the résumé', () => {
    const { verdict, review } = finalizeReview(raw(), RESUME, 'full');
    expect(verdict).toBe('strong');
    expect(review.requirements.map((r) => r.verified)).toEqual([true, true, false]);
    expect(review.demotedForUnverifiedEvidence).toBe(false);
  });

  it('moves strong to maybe when a met must-have cites a line that is not in the résumé', () => {
    const invented = raw({
      requirements: [{ text: 'Team lead', importance: 'must', status: 'met', evidence: 'Led a team of 8 engineers' }],
    });
    const { verdict, review } = finalizeReview(invented, RESUME, 'full');
    expect(verdict).toBe('maybe');
    expect(review).toMatchObject({ claudeVerdict: 'strong', demotedForUnverifiedEvidence: true });
  });

  it('does not demote over an unverified nice-to-have', () => {
    const niceOnly = raw({
      requirements: [
        { text: 'React', importance: 'must', status: 'met', evidence: 'from jQuery to React' },
        { text: 'Kafka', importance: 'nice', status: 'partial', evidence: 'event streaming with Kafka' },
      ],
    });
    expect(finalizeReview(niceOnly, RESUME, 'full').verdict).toBe('strong');
  });

  it('leaves maybe and skip verdicts as Claude gave them', () => {
    const invented = [{ text: 'Go', importance: 'must' as const, status: 'met' as const, evidence: 'Wrote Go services' }];
    expect(finalizeReview(raw({ verdict: 'maybe', requirements: invented }), RESUME, 'full').verdict).toBe('maybe');
    expect(finalizeReview(raw({ verdict: 'skip', requirements: invented }), RESUME, 'full').verdict).toBe('skip');
  });

  it('records where the description came from', () => {
    expect(finalizeReview(raw(), RESUME, 'summary').review.descriptionSource).toBe('summary');
  });
});
