import { describe, expect, it } from 'vitest';
import { buildScreenPrompt, parseScreenResponse } from '@/jobs/screen';
import { listingFingerprint } from '@/jobs/dedupe';
import type { JobFeedback } from '@/jobs/schema';
import { judged, listing } from './job-fixtures';

const context = {
  profileSummary: 'Software engineer, 2.5 years of TypeScript and Ruby.',
  resumeText: 'Built React and Rails tools for an e-commerce company.',
  criteria: 'Skip non-software roles like QA or field engineering.',
  disagreements: [] as JobFeedback[],
};

function candidate(overrides: Parameters<typeof listing>[0] = {}, sameTitleAs: ReturnType<typeof judged> | null = null) {
  const l = listing(overrides);
  return { listing: l, fingerprint: listingFingerprint(l), sameTitleAs };
}

describe('buildScreenPrompt', () => {
  it('gives Claude the profile, résumé, criteria and one JSON line per listing', () => {
    const { user } = buildScreenPrompt(
      [candidate(), candidate({ id: 'example:globex-1', company: 'Globex' })],
      context,
    );
    expect(user).toContain(context.profileSummary);
    expect(user).toContain(context.resumeText);
    expect(user).toContain(context.criteria);
    const lines = user.split('\n').filter((line) => line.startsWith('{'));
    expect(lines.map((line) => JSON.parse(line).id)).toEqual(['example:k2stripe0001', 'example:globex-1']);
  });

  it('adds the other listing only for same-title candidates', () => {
    const earlier = judged({ id: 'example:bd-1', company: 'Boston Dynamics', requirements: 'Original wording.' });
    const { user } = buildScreenPrompt(
      [candidate({ id: 'example:bd-2', company: 'Boston Dynamics' }, earlier), candidate()],
      context,
    );
    const [flagged, plain] = user
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    expect(flagged.sameTitleAs.requirements).toBe('Original wording.');
    expect(plain.sameTitleAs).toBeUndefined();
  });

  it('includes past disagreements so Claude follows the candidate on similar listings', () => {
    const { user } = buildScreenPrompt([candidate()], {
      ...context,
      disagreements: [
        {
          jobId: 'example:globex-9',
          agree: false,
          note: 'Java-only backend shops are a skip for me.',
          at: '2026-10-12T15:00:00.000Z',
          title: 'Backend Engineer',
          company: 'Globex',
          verdict: 'maybe',
        },
      ],
    });
    expect(user).toContain('You said maybe for "Backend Engineer" at Globex');
    expect(user).toContain('Java-only backend shops are a skip for me.');
  });

  it('marks missing inputs instead of leaving blank sections', () => {
    const { user } = buildScreenPrompt([candidate()], { ...context, resumeText: '', criteria: '' });
    expect(user).toContain('(no résumé uploaded)');
    expect(user).toContain('(none given)');
    expect(user).toContain('(none yet)');
  });

  it('tells Claude to send anything plausible on to the full review', () => {
    const { system } = buildScreenPrompt([candidate()], context);
    expect(system).toMatch(/When unsure, choose review/);
    expect(system).toMatch(/only a JSON array/);
  });
});

describe('parseScreenResponse', () => {
  it('reads a bare JSON array', () => {
    const results = parseScreenResponse('[{"id": "example:a", "verdict": "review", "reason": "React web role."}]');
    expect(results.get('example:a')).toEqual({ verdict: 'review', reason: 'React web role.' });
  });

  it('reads an array wrapped in a code fence or prose', () => {
    const results = parseScreenResponse(
      'Here you go:\n```json\n[{"id": "example:a", "verdict": "skip", "reason": " Field role. "}]\n```',
    );
    expect(results.get('example:a')).toEqual({ verdict: 'skip', reason: 'Field role.' });
  });

  it('ignores items with an unknown verdict', () => {
    const results = parseScreenResponse(
      '[{"id": "a", "verdict": "strong", "reason": "x"}, {"id": "b", "verdict": "repeat", "reason": "y"}]',
    );
    expect([...results.keys()]).toEqual(['b']);
  });

  it('returns no results for a reply that is not JSON', () => {
    expect(parseScreenResponse('I could not judge these listings.').size).toBe(0);
    expect(parseScreenResponse('[not json]').size).toBe(0);
  });
});
