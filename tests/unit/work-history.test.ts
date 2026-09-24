import { describe, expect, it, beforeEach } from 'vitest';
import { genericAdapter } from '@/adapters/generic';
import { assignHistoryGroups } from '@/adapters/history-groups';
import { valueForField } from '@/content/mapping';
import { fillField } from '@/content/filler';
import { migrateProfile } from '@/profile/migrations';
import {
  emptyEducation,
  emptyExperience,
  emptyProfile,
  type Experience,
  type Profile,
} from '@/profile/schema';
import type { DetectedField, FieldKind } from '@/adapters/types';

function detect(): DetectedField[] {
  return assignHistoryGroups(genericAdapter.detectFields(document));
}

function fieldById(fields: DetectedField[], id: string): DetectedField {
  const found = fields.find((f) => f.el.id === id);
  if (!found) throw new Error(`no detected field with id "${id}"`);
  return found;
}

function experienceBlock(index: number): string {
  return `
    <div class="entry">
      <label for="title-${index}">Job Title</label>
      <input id="title-${index}" name="title-${index}" />
      <label for="company-${index}">Company Name</label>
      <input id="company-${index}" name="company-${index}" />
      <label for="from-${index}">Start Date</label>
      <input id="from-${index}" name="from-${index}" />
      <label for="to-${index}">End Date</label>
      <input id="to-${index}" name="to-${index}" />
      <label for="desc-${index}">Role Description</label>
      <textarea id="desc-${index}" name="desc-${index}"></textarea>
    </div>`;
}

function educationBlock(index: number): string {
  return `
    <div class="entry">
      <label for="school-${index}">School</label>
      <input id="school-${index}" name="school-${index}" />
      <label for="degree-${index}">Degree</label>
      <input id="degree-${index}" name="degree-${index}" />
      <label for="edu-from-${index}">Start Date</label>
      <input id="edu-from-${index}" name="edu-from-${index}" />
    </div>`;
}

function withExperience(...entries: Array<Partial<Experience>>): Profile {
  return {
    ...emptyProfile(),
    experience: entries.map((e) => ({ ...emptyExperience(), ...e })),
  };
}

describe('assignHistoryGroups — repeating blocks', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('gives each repeated work block its own index in document order', () => {
    document.body.innerHTML = `<form>
      <div class="repeat">${experienceBlock(0)}${experienceBlock(1)}${experienceBlock(2)}</div>
    </form>`;
    const fields = detect();
    expect(fieldById(fields, 'title-0').group).toEqual({ kind: 'experience', index: 0 });
    expect(fieldById(fields, 'company-1').group).toEqual({ kind: 'experience', index: 1 });
    expect(fieldById(fields, 'desc-2').group).toEqual({ kind: 'experience', index: 2 });
  });

  it('assigns the shared date kinds to the block that contains them', () => {
    document.body.innerHTML = `<form>
      <div class="repeat">${experienceBlock(0)}${experienceBlock(1)}</div>
    </form>`;
    const fields = detect();
    expect(fieldById(fields, 'from-0').kind).toBe('startDate');
    expect(fieldById(fields, 'from-0').group).toEqual({ kind: 'experience', index: 0 });
    expect(fieldById(fields, 'to-1').kind).toBe('endDate');
    expect(fieldById(fields, 'to-1').group).toEqual({ kind: 'experience', index: 1 });
  });

  it('keeps work and education indexes in separate sequences', () => {
    document.body.innerHTML = `<form>
      <div class="repeat">${experienceBlock(0)}${experienceBlock(1)}</div>
      <div class="repeat">${educationBlock(0)}${educationBlock(1)}</div>
    </form>`;
    const fields = detect();
    expect(fieldById(fields, 'company-1').group).toEqual({ kind: 'experience', index: 1 });
    expect(fieldById(fields, 'school-1').group).toEqual({ kind: 'education', index: 1 });
    expect(fieldById(fields, 'edu-from-1').group).toEqual({
      kind: 'education',
      index: 1,
    });
  });

  it('treats a two-column layout inside one block as a single entry', () => {
    document.body.innerHTML = `<form>
      <div class="entry">
        <div class="col">
          <label for="title-0">Job Title</label>
          <input id="title-0" name="title-0" />
        </div>
        <div class="col">
          <label for="company-0">Company Name</label>
          <input id="company-0" name="company-0" />
        </div>
      </div>
    </form>`;
    const fields = detect();
    expect(fieldById(fields, 'title-0').group).toEqual({ kind: 'experience', index: 0 });
    expect(fieldById(fields, 'company-0').group).toEqual({
      kind: 'experience',
      index: 0,
    });
  });

  it('leaves a single work block at index 0', () => {
    document.body.innerHTML = `<form>${experienceBlock(0)}</form>`;
    const fields = detect();
    expect(fieldById(fields, 'title-0').group).toEqual({ kind: 'experience', index: 0 });
  });

  it('does not group a lone role-description textarea with no other work field', () => {
    document.body.innerHTML = `<form>
      <label for="desc">Describe your responsibilities</label>
      <textarea id="desc" name="desc"></textarea>
    </form>`;
    const fields = detect();
    const desc = fieldById(fields, 'desc');
    expect(desc.kind).toBe('roleDescription');
    expect(desc.group).toBeUndefined();
  });

  it('leaves ordinary contact fields ungrouped', () => {
    document.body.innerHTML = `<form>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
      <div class="repeat">${experienceBlock(0)}${experienceBlock(1)}</div>
    </form>`;
    const fields = detect();
    expect(fieldById(fields, 'email').group).toBeUndefined();
  });
});

describe('valueForField — work history entries', () => {
  it('reads the entry named by the group index', () => {
    const profile = withExperience(
      { jobTitle: 'Staff Engineer', employer: 'Stripe' },
      { jobTitle: 'Senior Engineer', employer: 'Shopify' },
    );
    expect(
      valueForField(profile, 'jobTitle', 'Job Title', { kind: 'experience', index: 1 }),
    ).toBe('Senior Engineer');
    expect(
      valueForField(profile, 'employer', 'Company', { kind: 'experience', index: 0 }),
    ).toBe('Stripe');
  });

  it('returns null past the end of the stored entries', () => {
    const profile = withExperience({ jobTitle: 'Staff Engineer' });
    expect(
      valueForField(profile, 'jobTitle', 'Job Title', { kind: 'experience', index: 4 }),
    ).toBeNull();
  });

  it('suppresses the end date for a job marked current', () => {
    const profile = withExperience({ startDate: '2022-03', endDate: '', current: true });
    const group = { kind: 'experience', index: 0 } as const;
    expect(valueForField(profile, 'startDate', 'From', group)).toBe('2022-03');
    expect(valueForField(profile, 'endDate', 'To', group)).toBeNull();
    expect(valueForField(profile, 'currentlyEmployed', 'Current', group)).toBe(true);
  });

  it('refuses to answer a date kind with no group, since the entry is unknown', () => {
    const profile = withExperience({ startDate: '2022-03' });
    expect(valueForField(profile, 'startDate', 'From')).toBeNull();
    expect(valueForField(profile, 'endDate', 'To')).toBeNull();
  });

  it('refuses to answer a role description with no group', () => {
    const profile = withExperience({ description: 'Ran the payments migration.' });
    expect(valueForField(profile, 'roleDescription', 'Describe your role')).toBeNull();
  });

  it('does not cross experience values into an education group', () => {
    const profile = withExperience({ jobTitle: 'Staff Engineer' });
    expect(
      valueForField(profile, 'jobTitle', 'Job Title', { kind: 'education', index: 0 }),
    ).toBeNull();
  });

  it('reads education entries by index', () => {
    const profile: Profile = {
      ...emptyProfile(),
      education: [
        { ...emptyEducation(), school: 'University of Waterloo', gpa: '3.9' },
        { ...emptyEducation(), school: 'Seneca College' },
      ],
    };
    expect(
      valueForField(profile, 'school', 'School', { kind: 'education', index: 1 }),
    ).toBe('Seneca College');
    expect(valueForField(profile, 'gpa', 'GPA', { kind: 'education', index: 0 })).toBe(
      '3.9',
    );
  });
});

describe('overwriting a value the site parsed wrong', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('replaces a prefilled title only when overwrite is on for that field', () => {
    document.body.innerHTML = `<form>
      <label for="title-0">Job Title</label>
      <input id="title-0" name="title-0" value="Sr. Engineer at Stripe" />
      <label for="company-0">Company Name</label>
      <input id="company-0" name="company-0" value="Stripe" />
    </form>`;
    const fields = detect();
    const title = fieldById(fields, 'title-0');

    const skipped = fillField(title, 'Staff Engineer', { forceOverwrite: false });
    expect(skipped.status).toBe('skipped');
    expect(skipped.note).toBe('already filled');
    expect((title.el as HTMLInputElement).value).toBe('Sr. Engineer at Stripe');

    const filled = fillField(title, 'Staff Engineer', { forceOverwrite: true });
    expect(filled.status).toBe('filled');
    expect((title.el as HTMLInputElement).value).toBe('Staff Engineer');
  });
});

describe('profile migration to schema 4', () => {
  it('lifts a single stored education object into a one-entry list', () => {
    const migrated = migrateProfile(
      {
        firstName: 'Nevin',
        education: {
          school: 'University of Waterloo',
          degree: "Bachelor's Degree",
          fieldOfStudy: 'Computer Science',
          gradYear: '2024',
        },
      },
      3,
    );
    expect(migrated.education).toHaveLength(1);
    expect(migrated.education[0]?.school).toBe('University of Waterloo');
    expect(migrated.education[0]?.gpa).toBe('');
    expect(migrated.experience).toEqual([]);
  });

  it('drops an all-blank education object rather than storing an empty entry', () => {
    const migrated = migrateProfile(
      { education: { school: '', degree: '', fieldOfStudy: '', gradYear: '' } },
      3,
    );
    expect(migrated.education).toEqual([]);
  });

  it('is idempotent, because migrations re-run until the next write', () => {
    const raw = { education: { school: 'University of Waterloo' } };
    const once = migrateProfile(raw, 3);
    const twice = migrateProfile(once, 3);
    expect(twice.education).toEqual(once.education);
  });
});

describe('fromKeywords — employment labels', () => {
  const cases: Array<[string, FieldKind]> = [
    ['job title', 'jobTitle'],
    ['position title', 'jobTitle'],
    ['employer', 'employer'],
    ['company name', 'employer'],
    ['organization name', 'employer'],
    ['company location', 'employerLocation'],
    ['gpa', 'gpa'],
    ['grade point average', 'gpa'],
    ['start date', 'startDate'],
    ['end date', 'endDate'],
  ];

  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it.each(cases)('classifies "%s" as %s', (label, kind) => {
    document.body.innerHTML = `<form>
      <label for="probe">${label}</label>
      <input id="probe" name="probe" />
    </form>`;
    expect(fieldById(detect(), 'probe').kind).toBe(kind);
  });

  it('does not steal a cover letter textarea', () => {
    document.body.innerHTML = `<form>
      <label for="cl">Cover Letter</label>
      <textarea id="cl" name="cl"></textarea>
    </form>`;
    expect(fieldById(detect(), 'cl').kind).toBe('coverLetter');
  });
});
