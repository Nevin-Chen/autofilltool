import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workdayAdapter } from '@/adapters/workday';
import { assignHistoryGroups } from '@/adapters/history-groups';
import { valueForField } from '@/content/mapping';
import { fillField } from '@/content/filler';
import { emptyEducation, emptyExperience, emptyProfile } from '@/profile/schema';
import type { DetectedField } from '@/adapters/types';
import type { Profile } from '@/profile/schema';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function detect(): DetectedField[] {
  return assignHistoryGroups(workdayAdapter.detectFields(document));
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
      location: 'Ottawa, ON',
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
      startDate: '2015-09',
    },
  ],
};

describe('workday My Experience page', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('workday-my-experience.html');
  });

  it('classifies each work-experience field from its automation id', () => {
    const fields = detect();
    expect(byId(fields, 'wx1-title').kind).toBe('jobTitle');
    expect(byId(fields, 'wx1-company').kind).toBe('employer');
    expect(byId(fields, 'wx1-location').kind).toBe('employerLocation');
    expect(byId(fields, 'wx1-current').kind).toBe('currentlyEmployed');
    expect(byId(fields, 'wx1-desc').kind).toBe('roleDescription');
  });

  it('classifies each education field from its automation id', () => {
    const fields = detect();
    expect(byId(fields, 'ed1-school').kind).toBe('school');
    expect(byId(fields, 'ed1-degree').kind).toBe('degree');
    expect(byId(fields, 'ed1-field').kind).toBe('fieldOfStudy');
    expect(byId(fields, 'ed1-gpa').kind).toBe('gpa');
  });

  it('numbers the two work blocks and the two education blocks separately', () => {
    const fields = detect();
    expect(byId(fields, 'wx1-title').group).toEqual({
      kind: 'experience',
      index: 0,
    });
    expect(byId(fields, 'wx2-title').group).toEqual({
      kind: 'experience',
      index: 1,
    });
    expect(byId(fields, 'ed1-school').group).toEqual({
      kind: 'education',
      index: 0,
    });
    expect(byId(fields, 'ed2-school').group).toEqual({
      kind: 'education',
      index: 1,
    });
  });

  it('splits the month and year halves of a date widget into their own fields', () => {
    const fields = detect();
    const month = byId(fields, 'wx1-from-month');
    const year = byId(fields, 'wx1-from-year');
    expect(month.kind).toBe('startDate');
    expect(month.datePart).toBe('month');
    expect(year.kind).toBe('startDate');
    expect(year.datePart).toBe('year');
    expect(month.group).toEqual({ kind: 'experience', index: 0 });
  });

  it('writes 2022-03 as month 03 and year 2022 into the two sub-inputs', () => {
    const fields = detect();
    const month = byId(fields, 'wx1-from-month');
    const year = byId(fields, 'wx1-from-year');
    const value = valueForField(PROFILE, month.kind, month.label, month.group);
    expect(value).toBe('2022-03');
    expect(fillField(month, value, { forceOverwrite: false }).status).toBe('filled');
    expect(fillField(year, value, { forceOverwrite: false }).status).toBe('filled');
    expect((month.el as HTMLInputElement).value).toBe('03');
    expect((year.el as HTMLInputElement).value).toBe('2022');
  });

  it('leaves the end date of a current job blank', () => {
    const fields = detect();
    const toMonth = byId(fields, 'wx1-to-month');
    const value = valueForField(PROFILE, toMonth.kind, toMonth.label, toMonth.group);
    expect(value).toBeNull();
    expect(fillField(toMonth, value, { forceOverwrite: false }).status).toBe('skipped');
    expect((toMonth.el as HTMLInputElement).value).toBe('');
  });

  it('fills the second block from the second stored job', () => {
    const fields = detect();
    const title = byId(fields, 'wx2-title');
    const company = byId(fields, 'wx2-company');
    expect(valueForField(PROFILE, title.kind, title.label, title.group)).toBe(
      'Senior Engineer',
    );
    expect(valueForField(PROFILE, company.kind, company.label, company.group)).toBe(
      'Shopify',
    );
  });

  it('leaves a block with no stored job empty rather than repeating the last one', () => {
    const fields = detect();
    const school = byId(fields, 'ed2-school');
    expect(valueForField(PROFILE, school.kind, school.label, school.group)).toBeNull();
  });

  it('checks "I currently work here" only for the job marked current', () => {
    const fields = detect();
    const first = byId(fields, 'wx1-current');
    const second = byId(fields, 'wx2-current');
    expect(valueForField(PROFILE, first.kind, first.label, first.group)).toBe(true);
    expect(valueForField(PROFILE, second.kind, second.label, second.group)).toBe(false);
  });

  it('does not treat the contact email as part of a history block', () => {
    const fields = detect();
    const email = byId(fields, 'contact-email');
    expect(email.kind).toBe('email');
    expect(email.group).toBeUndefined();
  });

  it('replaces a title the site parsed wrong when overwrite is on', () => {
    const wrong = document.getElementById('wx1-title') as HTMLInputElement;
    wrong.value = 'Staff Engineer at Stripe';
    const title = byId(detect(), 'wx1-title');
    const value = valueForField(PROFILE, title.kind, title.label, title.group);

    expect(fillField(title, value, { forceOverwrite: false }).note).toBe(
      'already filled',
    );
    expect(wrong.value).toBe('Staff Engineer at Stripe');

    expect(fillField(title, value, { forceOverwrite: true }).status).toBe('filled');
    expect(wrong.value).toBe('Staff Engineer');
  });
});
