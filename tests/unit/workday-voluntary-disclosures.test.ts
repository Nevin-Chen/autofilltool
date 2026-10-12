import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workdayAdapter } from '@/adapters/workday';
import { valueForField } from '@/content/mapping';
import { fillDetectedField, fillSiteAnswer } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';

const OPTIONS: Record<string, string[]> = {
  'personalInfoUS--gender': ['Choose not to Disclose', 'Female', 'Male'],
  'personalInfoUS--hispanicOrLatino': ['Yes', 'No'],
  'personalInfoUS--ethnicity': [
    'Asian (Not Hispanic or Latino) (United States of America)',
    'Black or African American (Not Hispanic or Latino) (United States of America)',
    'Hawaiian or Pacific Islander (Not Hispanic or Latino) (United States of America)',
    'Hispanic or Latino (United States of America)',
    'I choose not to disclose this information (United States of America)',
    'Native American (Not Hispanic or Latino) (United States of America)',
    'Two or More Races (Not Hispanic or Latino) (United States of America)',
    'White (Not Hispanic or Latino) (United States of America)',
  ],
};

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/workday-voluntary-disclosures.html'),
    'utf8',
  );
  for (const [id, options] of Object.entries(OPTIONS)) {
    const button = document.getElementById(id)!;
    button.addEventListener('click', () => {
      const open = document.getElementById(`${id}-options`);
      if (open) {
        open.remove();
        return;
      }
      const list = document.createElement('ul');
      list.id = `${id}-options`;
      list.setAttribute('role', 'listbox');
      for (const name of ['Select One', ...options]) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = name;
        li.addEventListener('click', () => {
          button.textContent = name;
          list.remove();
        });
        list.append(li);
      }
      document.body.append(list);
      button.setAttribute('aria-controls', list.id);
    });
  }
}

function withDemographics(demographics: Partial<Profile['demographics']>): Profile {
  const p = emptyProfile();
  return { ...p, demographics: { ...p.demographics, ...demographics } };
}

async function fillPage(profile: Profile): Promise<Record<string, string>> {
  const opts = { forceOverwrite: false, suppressFlash: true };
  for (const answer of workdayAdapter.siteAnswers!(document)) await fillSiteAnswer(answer, opts);
  for (const field of workdayAdapter.detectFields(document)) {
    await fillDetectedField(field, valueForField(profile, field.kind, field.label), opts);
  }
  return Object.fromEntries(
    Object.keys(OPTIONS).map((id) => [id.replace('personalInfoUS--', ''), document.getElementById(id)!.textContent!.trim()]),
  );
}

describe('workday Voluntary Disclosures page', () => {
  beforeEach(() => {
    loadFixture();
  });

  it('reads the questions off their labels, so the "ethnicity" wrapper gets the race answer', () => {
    const kinds = Object.fromEntries(workdayAdapter.detectFields(document).map((f) => [f.el.id, f.kind]));
    expect(kinds).toEqual({
      'personalInfoUS--gender': 'gender',
      'personalInfoUS--hispanicOrLatino': 'ethnicity',
      'personalInfoUS--ethnicity': 'race',
    });
  });

  it('fills the self-ID answers and ticks the required terms box', async () => {
    const page = await fillPage(withDemographics({ gender: 'Female', ethnicity: 'No', race: 'White' }));
    expect(page).toEqual({
      gender: 'Female',
      hispanicOrLatino: 'No',
      ethnicity: 'White (Not Hispanic or Latino) (United States of America)',
    });
    expect(
      (document.getElementById('termsAndConditions--acceptTermsAndAgreements') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("maps the profile's race wording onto Workday's", async () => {
    const page = await fillPage(withDemographics({ race: 'American Indian or Alaska Native' }));
    expect(page.ethnicity).toBe('Native American (Not Hispanic or Latino) (United States of America)');
    loadFixture();
    const islander = await fillPage(withDemographics({ race: 'Native Hawaiian or Other Pacific Islander' }));
    expect(islander.ethnicity).toBe('Hawaiian or Pacific Islander (Not Hispanic or Latino) (United States of America)');
  });

  it('turns "Decline to self-identify" into the decline option each question offers', async () => {
    const page = await fillPage(
      withDemographics({ gender: 'Decline to self-identify', race: 'Decline to self-identify' }),
    );
    expect(page.gender).toBe('Choose not to Disclose');
    expect(page.ethnicity).toBe('I choose not to disclose this information (United States of America)');
  });

  it('keeps the terms box away from the AI fallback', () => {
    const ids = workdayAdapter.detectAll!(document).unclassified.map((u) => u.el.id);
    expect(ids).not.toContain('termsAndConditions--acceptTermsAndAgreements');
  });
});
