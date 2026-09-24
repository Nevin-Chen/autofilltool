import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workableAdapter } from '@/adapters/workable';
import { assignHistoryGroups } from '@/adapters/history-groups';
import { historyKindFromName } from '@/adapters/_shared';
import { valueForField } from '@/content/mapping';
import { emptyEducation, emptyExperience, emptyProfile } from '@/profile/schema';
import type { DetectedField, FieldKind } from '@/adapters/types';
import type { Profile } from '@/profile/schema';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function detect(): DetectedField[] {
  return assignHistoryGroups(workableAdapter.detectFields(document));
}

function byId(fields: DetectedField[], id: string): DetectedField {
  const found = fields.find((f) => f.el.id === id);
  if (!found) throw new Error(`no detected field with id "${id}"`);
  return found;
}

const PROFILE: Profile = {
  ...emptyProfile(),
  firstName: 'Nevin',
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
      endDate: '2019-06',
    },
  ],
};

describe('historyKindFromName', () => {
  const cases: Array<[string, FieldKind]> = [
    ['experience[0][title]', 'jobTitle'],
    ['experience[1][company]', 'employer'],
    ['experience[0][current]', 'currentlyEmployed'],
    ['experience[0][start_date]', 'startDate'],
    ['experience[0][end_date]', 'endDate'],
    ['experience[0][summary]', 'roleDescription'],
    ['education[0][school]', 'school'],
    ['education[0][degree]', 'degree'],
    ['education[0][field_of_study]', 'fieldOfStudy'],
    ['education_entries[2][school_name]', 'school'],
    ['work_history_1_job_title', 'jobTitle'],
    ['candidate[education_attributes][0][gpa]', 'gpa'],
  ];

  it.each(cases)('reads %s as %s', (name, kind) => {
    expect(historyKindFromName(name)?.kind).toBe(kind);
  });

  it('ignores a name with no entry index, which is not a repeating block', () => {
    expect(historyKindFromName('experience[title]')).toBeNull();
    expect(historyKindFromName('current_employer')).toBeNull();
  });

  it('ignores a name with no history section, so ordinary fields fall through', () => {
    expect(historyKindFromName('firstname')).toBeNull();
    expect(historyKindFromName('QA_12')).toBeNull();
    expect(historyKindFromName('address[0][city]')).toBeNull();
  });
});

describe('workable application form with history entries', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('workable-history.html');
  });

  it('classifies the history fields from their bracketed names', () => {
    const fields = detect();
    expect(byId(fields, 'exp-0-title').kind).toBe('jobTitle');
    expect(byId(fields, 'exp-0-company').kind).toBe('employer');
    expect(byId(fields, 'exp-0-summary').kind).toBe('roleDescription');
    expect(byId(fields, 'edu-0-school').kind).toBe('school');
    expect(byId(fields, 'edu-0-field').kind).toBe('fieldOfStudy');
  });

  it('takes the entry index straight from the name', () => {
    const fields = detect();
    expect(byId(fields, 'exp-0-title').group).toEqual({
      kind: 'experience',
      index: 0,
    });
    expect(byId(fields, 'exp-1-title').group).toEqual({
      kind: 'experience',
      index: 1,
    });
    expect(byId(fields, 'edu-1-school').group).toEqual({
      kind: 'education',
      index: 1,
    });
  });

  it('assigns the shared date kinds to the right section and entry', () => {
    const fields = detect();
    expect(byId(fields, 'exp-1-end').kind).toBe('endDate');
    expect(byId(fields, 'exp-1-end').group).toEqual({
      kind: 'experience',
      index: 1,
    });
    expect(byId(fields, 'edu-0-end').group).toEqual({
      kind: 'education',
      index: 0,
    });
  });

  it('fills each entry from its matching stored job', () => {
    const fields = detect();
    const read = (id: string) => {
      const f = byId(fields, id);
      return valueForField(PROFILE, f.kind, f.label, f.group);
    };
    expect(read('exp-0-title')).toBe('Staff Engineer');
    expect(read('exp-0-company')).toBe('Stripe');
    expect(read('exp-1-title')).toBe('Senior Engineer');
    expect(read('exp-1-end')).toBe('2022-02');
    expect(read('exp-0-end')).toBeNull();
    expect(read('edu-0-school')).toBe('University of Waterloo');
    expect(read('edu-1-school')).toBeNull();
  });

  it('still classifies the ordinary fields it always did', () => {
    const fields = detect();
    expect(byId(fields, 'firstname').kind).toBe('firstName');
    expect(byId(fields, 'email').kind).toBe('email');
    expect(byId(fields, 'cover_letter').kind).toBe('coverLetter');
    expect(byId(fields, 'firstname').group).toBeUndefined();
    expect(byId(fields, 'cover_letter').group).toBeUndefined();
  });
});
