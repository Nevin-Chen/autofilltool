import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { breezyAdapter } from '@/adapters/breezy';
import { assignHistoryGroups } from '@/adapters/history-groups';
import { valueForField } from '@/content/mapping';
import { emptyEducation, emptyExperience, emptyProfile } from '@/profile/schema';
import type { DetectedField } from '@/adapters/types';
import type { Profile } from '@/profile/schema';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function detect(): DetectedField[] {
  return assignHistoryGroups(breezyAdapter.detectFields(document));
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
      location: 'Toronto, ON',
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
      endDate: '2019-06',
    },
  ],
};

describe('breezy work history and education', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('breezy-history.html');
  });

  it('classifies history fields that the question allowlist used to drop', () => {
    const fields = detect();
    expect(byId(fields, 'wh-0-title').kind).toBe('jobTitle');
    expect(byId(fields, 'wh-0-company').kind).toBe('employer');
    expect(byId(fields, 'wh-0-location').kind).toBe('employerLocation');
    expect(byId(fields, 'wh-0-summary').kind).toBe('roleDescription');
    expect(byId(fields, 'eh-0-school').kind).toBe('school');
    expect(byId(fields, 'eh-0-field').kind).toBe('fieldOfStudy');
  });

  it('numbers each repeated entry', () => {
    const fields = detect();
    expect(byId(fields, 'wh-0-title').group).toEqual({
      kind: 'experience',
      index: 0,
    });
    expect(byId(fields, 'wh-1-title').group).toEqual({
      kind: 'experience',
      index: 1,
    });
    expect(byId(fields, 'eh-1-school').group).toEqual({
      kind: 'education',
      index: 1,
    });
  });

  it('keeps the education end date out of the work section', () => {
    const fields = detect();
    expect(byId(fields, 'eh-0-end').kind).toBe('endDate');
    expect(byId(fields, 'eh-0-end').group).toEqual({
      kind: 'education',
      index: 0,
    });
    expect(byId(fields, 'wh-1-end').group).toEqual({
      kind: 'experience',
      index: 1,
    });
  });

  it('fills each entry from its matching stored entry', () => {
    const fields = detect();
    const read = (id: string) => {
      const f = byId(fields, id);
      return valueForField(PROFILE, f.kind, f.label, f.group);
    };
    expect(read('wh-0-title')).toBe('Staff Engineer');
    expect(read('wh-0-location')).toBe('Toronto, ON');
    expect(read('wh-0-summary')).toBe('Led the payments ledger migration.');
    expect(read('wh-1-company')).toBe('Shopify');
    expect(read('wh-1-end')).toBe('2022-02');
    expect(read('wh-0-end')).toBeNull();
    expect(read('eh-0-degree')).toBe("Bachelor's Degree");
    expect(read('eh-1-school')).toBeNull();
  });

  it('leaves the cover letter and the open question alone', () => {
    const fields = detect();
    expect(byId(fields, 'cCoverLetter').kind).toBe('coverLetter');
    expect(byId(fields, 'q-why').kind).toBe('openEnded');
    expect(byId(fields, 'q-why').group).toBeUndefined();
  });

  it('still classifies the name and email it always did', () => {
    const fields = detect();
    expect(byId(fields, 'cName').kind).toBe('fullName');
    expect(byId(fields, 'cEmail').kind).toBe('email');
    expect(byId(fields, 'cName').group).toBeUndefined();
  });
});
