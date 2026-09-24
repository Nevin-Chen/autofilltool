import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jazzhrAdapter } from '@/adapters/jazzhr';
import { assignHistoryGroups } from '@/adapters/history-groups';
import { historyKindFromName } from '@/adapters/_shared';
import { valueForField } from '@/content/mapping';
import { emptyEducation, emptyExperience, emptyProfile } from '@/profile/schema';
import type { DetectedField } from '@/adapters/types';
import type { Profile } from '@/profile/schema';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function detect(): DetectedField[] {
  return assignHistoryGroups(jazzhrAdapter.detectFields(document));
}

function byId(fields: DetectedField[], id: string): DetectedField {
  const found = fields.find((f) => f.el.id === id);
  if (!found) throw new Error(`no detected field with id "${id}"`);
  return found;
}

const PROFILE: Profile = {
  ...emptyProfile(),
  experience: [
    {
      ...emptyExperience(),
      jobTitle: 'Staff Engineer',
      employer: 'Stripe',
      startDate: '2022-03',
      current: true,
      description: 'Led the payments ledger migration.',
    },
    {
      ...emptyExperience(),
      jobTitle: 'Senior Engineer',
      employer: 'Shopify',
      startDate: '2019-07',
      endDate: '2022-02',
    },
  ],
  education: [
    {
      ...emptyEducation(),
      school: 'University of Waterloo',
      degree: "Bachelor's Degree",
      fieldOfStudy: 'Computer Science',
      gpa: '3.8',
    },
  ],
};

describe('jazzhr questionnaire history entries', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('jazzhr-history.html');
  });

  it('classifies history questions that the questionnaire allowlist used to drop', () => {
    const fields = detect();
    expect(byId(fields, 'rq-100').kind).toBe('jobTitle');
    expect(byId(fields, 'rq-101').kind).toBe('employer');
    expect(byId(fields, 'rq-102').kind).toBe('startDate');
    expect(byId(fields, 'rq-104').kind).toBe('roleDescription');
    expect(byId(fields, 'rq-300').kind).toBe('school');
    expect(byId(fields, 'rq-303').kind).toBe('gpa');
  });

  it('numbers the repeated blocks from the page structure, since the names carry no index', () => {
    const fields = detect();
    expect(byId(fields, 'rq-100').group).toEqual({ kind: 'experience', index: 0 });
    expect(byId(fields, 'rq-200').group).toEqual({ kind: 'experience', index: 1 });
    expect(byId(fields, 'rq-300').group).toEqual({ kind: 'education', index: 0 });
    expect(byId(fields, 'rq-400').group).toEqual({ kind: 'education', index: 1 });
  });

  it('fills each block from its matching stored entry', () => {
    const fields = detect();
    const read = (id: string) => {
      const f = byId(fields, id);
      return valueForField(PROFILE, f.kind, f.label, f.group);
    };
    expect(read('rq-100')).toBe('Staff Engineer');
    expect(read('rq-101')).toBe('Stripe');
    expect(read('rq-104')).toBe('Led the payments ledger migration.');
    expect(read('rq-200')).toBe('Senior Engineer');
    expect(read('rq-203')).toBe('2022-02');
    expect(read('rq-103')).toBeNull();
    expect(read('rq-300')).toBe('University of Waterloo');
    expect(read('rq-400')).toBeNull();
  });

  it('leaves the cover letter and the open question alone', () => {
    const fields = detect();
    expect(byId(fields, 'resumator-coverletter-value').kind).toBe('coverLetter');
    const open = byId(fields, 'rq-900');
    expect(open.kind).toBe('openEnded');
    expect(open.group).toBeUndefined();
  });

  it('still classifies the fields it always did', () => {
    const fields = detect();
    expect(byId(fields, 'resumator-firstname-value').kind).toBe('firstName');
    expect(byId(fields, 'resumator-email-value').kind).toBe('email');
    expect(byId(fields, 'resumator-firstname-value').group).toBeUndefined();
  });
});

describe('historyKindFromName — singular section words', () => {
  it('reads a job- or employer-prefixed indexed name', () => {
    expect(historyKindFromName('resumator-job-0-title-value')?.kind).toBe('jobTitle');
    expect(historyKindFromName('resumator-job-1-company-value')?.kind).toBe('employer');
    expect(historyKindFromName('employer_1_name')?.kind).toBe('employer');
    expect(historyKindFromName('schools_0_name')?.kind).toBe('school');
  });

  it('does not read a bare job title as a repeating entry', () => {
    expect(historyKindFromName('job_title')).toBeNull();
    expect(historyKindFromName('resumator-jobtitle-value')).toBeNull();
  });
});
