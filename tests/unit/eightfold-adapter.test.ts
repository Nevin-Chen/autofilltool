import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eightfoldAdapter } from '@/adapters/eightfold';
import { pickAdapter } from '@/content/detector';
import { fillDetectedField, fillField, harvestComboboxOptions } from '@/content/filler';
import { isAtsFrameUrl } from '@/background/frames';
import { companyKeyFromUrl } from '@/profile/resume-select';
import { extractJobContext } from '@/content/job-context';
import { unclassifiedFromDetected } from '@/adapters/_shared';
import type { DetectedField, UnclassifiedField } from '@/adapters/types';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

const APPLY_URL = 'https://globex.eightfold.ai/careers/apply?pid=123456789012';

const COUNTRY_CODES = [
  '🇨🇦 (+1) Canada',
  '🇬🇧 (+44) United Kingdom',
  '🇺🇲 (+1) United States Minor Outlying Islands',
  '🇺🇸 (+1) United States of America',
];

function fieldLabelled<T extends { label: string }>(fields: T[], start: string): T | undefined {
  return fields.find((f) => f.label.startsWith(start));
}

function comboboxFor(labelId: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[aria-labelledby="${labelId}"]`);
  if (!input) throw new Error(`no combobox labelled by ${labelId}`);
  return input;
}

function countryCodeInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[aria-label="Country code"]')!;
}

function mountOctupleSelect(input: HTMLInputElement, options: string[]): void {
  const listId = input.getAttribute('aria-controls')!;
  const mainWrapper = input.closest('.dropdown-module_main-wrapper__Q-inC')!;
  const close = () => {
    mainWrapper.querySelector('.select-module_select-dropdown-overlay__G4p-2')?.remove();
    input.setAttribute('aria-expanded', 'false');
  };
  const render = () => {
    close();
    const typed = options.includes(input.value) ? '' : input.value.toLowerCase();
    const overlay = document.createElement('div');
    overlay.className = 'select-module_select-dropdown-overlay__G4p-2';
    const list = document.createElement('ul');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    for (const text of options.filter((o) => o.toLowerCase().includes(typed))) {
      const item = document.createElement('li');
      item.setAttribute('role', 'presentation');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.title = text;
      button.setAttribute('aria-selected', String(input.value === text));
      button.innerHTML = `<span><span><span>${text}</span></span></span>`;
      button.addEventListener('click', () => {
        input.value = input.value === text ? '' : text;
        close();
      });
      item.append(button);
      list.append(item);
    }
    overlay.append(list);
    mainWrapper.append(overlay);
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('click', () => {
    if (input.getAttribute('aria-expanded') !== 'true') render();
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

describe('eightfold adapter — matches()', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('matches an eightfold.ai careers page', () => {
    expect(eightfoldAdapter.matches(new URL(APPLY_URL), document)).toBe(true);
  });

  it('matches the apply form on a careers site with its own domain', () => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
    expect(eightfoldAdapter.matches(new URL('https://careers.globex.dev/apply'), document)).toBe(
      true,
    );
  });

  it('does not match an unrelated page', () => {
    expect(eightfoldAdapter.matches(new URL('https://eightfold.example.com/'), document)).toBe(
      false,
    );
  });

  it('is the adapter the registry picks for an Eightfold apply page', () => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
    expect(pickAdapter(new URL(APPLY_URL), document).id).toBe('eightfold');
  });
});

describe('eightfold adapter — detectFields()', () => {
  let fields: DetectedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
    fields = eightfoldAdapter.detectFields(document);
  });

  const kindOf = (id: string) => fields.find((f) => f.el.id === id)?.kind;

  it('maps the platform contact and address fields by key', () => {
    expect(fields.find((f) => f.el.id === 'Contact_Information_firstname')).toMatchObject({
      kind: 'firstName',
      label: 'Legal First Name',
    });
    expect(kindOf('Contact_Information_lastname')).toBe('lastName');
    expect(kindOf('Contact_Information_email')).toBe('email');
    expect(kindOf('Application_questions_q_addressLine1')).toBe('addressLine1');
    expect(kindOf('Application_questions_q_city')).toBe('city');
    expect(kindOf('Application_questions_q_zip')).toBe('postalCode');
    expect(fields.find((f) => f.label === 'Country')).toMatchObject({
      kind: 'country',
      widget: 'clickListbox',
    });
  });

  it('splits the phone into the country code dropdown and the national number', () => {
    expect(fields.find((f) => f.el === countryCodeInput())).toMatchObject({
      kind: 'phoneCountry',
      label: 'Country code',
      widget: 'clickListbox',
    });
    expect(fields.find((f) => f.el.id === 'Contact_Information_phone')).toMatchObject({
      kind: 'phoneNational',
      label: 'Phone',
    });
  });

  it('maps the work authorization radios to the profile answer, labelled by the question', () => {
    const auth = fieldLabelled(fields, 'Are you legally eligible to work');
    expect(auth?.kind).toBe('authorizedToWorkInUS');
    expect(auth?.el.id).toBe('Application_questions_480211_1-0.0');
  });

  it('does not read "authorized to work" out of the aside on the work status assistance question', () => {
    expect(fieldLabelled(fields, 'Do you now, or will you in the future')).toBeUndefined();
    expect(fieldLabelled(fields, 'If you currently, or will in the future')).toBeUndefined();
  });

  it('leaves the degree and experience screening questions for the model', () => {
    expect(fieldLabelled(fields, '1. Do you have a Bachelor')).toBeUndefined();
    expect(fieldLabelled(fields, '2. Do you have 3 years')).toBeUndefined();
  });

  it('reads the self-identification dropdowns as click-to-commit listboxes', () => {
    for (const [label, kind] of [
      ['Gender', 'gender'],
      ['Pronouns', 'pronouns'],
      ['Ethnicity', 'ethnicity'],
      ['Protected Veteran Status', 'veteranStatus'],
    ] as const) {
      expect(fields.find((f) => f.label === label)).toMatchObject({ kind, widget: 'clickListbox' });
    }
  });

  it('does not answer employer questions that mention "currently employed" or "full name"', () => {
    expect(fieldLabelled(fields, 'Are you related to anyone')).toBeUndefined();
    expect(fieldLabelled(fields, 'If you answered Yes for being related')).toBeUndefined();
    expect(fieldLabelled(fields, 'Other Phone Number')).toBeUndefined();
  });

  it('reads a LinkedIn field the employer added', () => {
    expect(kindOf('Application_questions_q_customLinkedIn')).toBe('linkedin');
  });

  it('never returns a button or a file input', () => {
    expect(fields.every((f) => f.el instanceof HTMLInputElement && f.el.type !== 'file')).toBe(
      true,
    );
  });
});

describe('eightfold adapter — detectAll() unclassified questions', () => {
  let unclassified: UnclassifiedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
    unclassified = eightfoldAdapter.detectAll!(document).unclassified;
  });

  it('hands the screening radios to the model with their options', () => {
    expect(fieldLabelled(unclassified, 'Are you currently in F-1 Visa status?')).toMatchObject({
      fieldType: 'radio',
      options: ['Yes', 'No'],
    });
    expect(fieldLabelled(unclassified, 'Do you now, or will you in the future')).toMatchObject({
      fieldType: 'radio',
    });
    expect(fieldLabelled(unclassified, '2. Do you have 3 years')).toMatchObject({
      fieldType: 'radio',
      options: ['YES', 'NO'],
    });
    expect(fieldLabelled(unclassified, 'I certify that all statements')?.fieldType).toBe('radio');
  });

  it('routes the employer dropdowns through the click-to-commit filler', () => {
    expect(fieldLabelled(unclassified, 'Are you related to anyone')).toMatchObject({
      fieldType: 'combobox',
      widget: 'clickListbox',
    });
    expect(fieldLabelled(unclassified, 'A recruiter may contact me')).toMatchObject({
      fieldType: 'combobox',
      widget: 'clickListbox',
    });
  });

  it('includes the free-text questions and nothing outside the form sections', () => {
    expect(fieldLabelled(unclassified, 'If you currently, or will in the future')?.fieldType).toBe(
      'text',
    );
    expect(unclassified.every((u) => u.el.closest('fieldset[data-form-section-id]'))).toBe(true);
  });

  it('keeps the widget when a skipped dropdown goes back to the model', () => {
    const gender = eightfoldAdapter.detectFields(document).find((f) => f.label === 'Gender')!;
    expect(unclassifiedFromDetected(gender)).toMatchObject({
      fieldType: 'combobox',
      widget: 'clickListbox',
    });
  });
});

describe('eightfold adapter — filling', () => {
  let fields: DetectedField[];
  const field = (label: string) => fields.find((f) => f.label === label)!;
  const opts = { forceOverwrite: false, suppressFlash: true };

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
    mountOctupleSelect(comboboxFor('Application_questions_q_customGenderPreOffer_label'), [
      'Female',
      'I do not wish to provide this information',
      'Male',
    ]);
    mountOctupleSelect(comboboxFor('Application_questions_q_customEthnicity_label'), [
      'I do not wish to provide this information',
      'Hispanic/Latino',
      'Not Hispanic/Latino',
    ]);
    mountOctupleSelect(comboboxFor('Application_questions_q_veteranStatus_label'), [
      'I am not a Veteran',
      'I prefer not to answer',
      'I am a Veteran - Not Protected',
      'I am a Veteran - Protected',
    ]);
    mountOctupleSelect(countryCodeInput(), COUNTRY_CODES);
    fields = eightfoldAdapter.detectFields(document);
  });

  it('opens the dropdown and clicks the option, since Enter does not commit', async () => {
    const gender = field('Gender');
    const action = await fillDetectedField(gender, 'Male', opts);
    expect(action).toMatchObject({ status: 'filled', note: 'selected "Male"' });
    expect((gender.el as HTMLInputElement).value).toBe('Male');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('picks the United States country code over the outlying islands', async () => {
    const action = await fillDetectedField(field('Country code'), 'United States', opts);
    expect(action.status).toBe('filled');
    expect(countryCodeInput().value).toBe('🇺🇸 (+1) United States of America');
  });

  it('maps the saved Hispanic or Latino answer onto the ethnicity options', async () => {
    await fillDetectedField(field('Ethnicity'), 'No', opts);
    expect((field('Ethnicity').el as HTMLInputElement).value).toBe('Not Hispanic/Latino');
  });

  it('maps a declined answer to "I do not wish to provide this information"', async () => {
    await fillDetectedField(field('Gender'), 'Decline to self-identify', opts);
    expect((field('Gender').el as HTMLInputElement).value).toBe(
      'I do not wish to provide this information',
    );
  });

  it('maps "not a protected veteran" to the plain not-a-veteran option', async () => {
    const veteran = field('Protected Veteran Status');
    await fillDetectedField(veteran, 'I am not a protected veteran', opts);
    expect((veteran.el as HTMLInputElement).value).toBe('I am not a Veteran');
  });

  it('skips a dropdown that already shows an answer', async () => {
    const gender = field('Gender');
    (gender.el as HTMLInputElement).value = 'Female';
    const action = await fillDetectedField(gender, 'Male', opts);
    expect(action).toMatchObject({ status: 'skipped', note: 'already filled' });
  });

  it('does not click the option already selected, which would clear it', async () => {
    const gender = field('Gender');
    await fillDetectedField(gender, 'Male', opts);
    const action = await fillDetectedField(gender, 'Male', { ...opts, forceOverwrite: true });
    expect(action).toMatchObject({ status: 'skipped', note: 'already in desired state' });
    expect((gender.el as HTMLInputElement).value).toBe('Male');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('closes the dropdown when no option matches', async () => {
    const action = await fillDetectedField(field('Gender'), 'Non-binary', opts);
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/^no option matched/);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('harvests the options for the model and closes the dropdown', async () => {
    expect(await harvestComboboxOptions(field('Gender').el)).toEqual([
      'Female',
      'I do not wish to provide this information',
      'Male',
    ]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('checks only the matching radio in the work authorization question', () => {
    const auth = fieldLabelled(fields, 'Are you legally eligible to work')!;
    expect(fillField(auth, 'Yes', opts).status).toBe('filled');
    const checked = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked'),
    ).map((r) => r.id);
    expect(checked).toEqual(['Application_questions_480211_1-0.0']);
  });
});

describe('eightfold adapter — resume, job description and confirmation', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
  });

  it('attaches the resume to the resume dropzone, not the attachments one', async () => {
    const file = new File([new Uint8Array([7, 7])], 'cv.pdf', { type: 'application/pdf' });
    expect(await eightfoldAdapter.fillResume!(file, document)).toBe(true);
    const [resume, attachments] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    expect(resume?.files?.[0]?.name).toBe('cv.pdf');
    expect(attachments?.files?.length ?? 0).toBe(0);
  });

  it('reads the posting body from the JobPosting JSON-LD, not the form', () => {
    const jd = eightfoldAdapter.getJobDescription(document);
    expect(jd).toContain('build the embedded control loops');
    expect(jd).toContain('embedded Linux & real-time systems');
    expect(jd).not.toContain('Legal First Name');
  });

  it('is not confirmed while the form is on the page', () => {
    expect(eightfoldAdapter.detectSubmissionConfirmed!(document, new URL(APPLY_URL))).toBe(false);
  });

  it('is confirmed on the success route', () => {
    const url = new URL('https://globex.eightfold.ai/careers/apply/success?pid=123456789012');
    expect(eightfoldAdapter.detectSubmissionConfirmed!(document, url)).toBe(true);
  });

  it('is confirmed by the success view once the form is gone', () => {
    document.body.innerHTML =
      '<img src="https://static.vscdn.net/images/application-submitted-confirmation.svg" alt=""><h1>Application Submitted</h1>';
    expect(eightfoldAdapter.detectSubmissionConfirmed!(document, new URL(APPLY_URL))).toBe(true);
  });
});

describe('eightfold adapter — URL helpers', () => {
  it('treats eightfold.ai frames as ATS frames', () => {
    expect(isAtsFrameUrl(APPLY_URL)).toBe(true);
    expect(isAtsFrameUrl('https://eightfold.example.com/')).toBe(false);
  });

  it('keys the resume choice by the tenant host', () => {
    expect(companyKeyFromUrl(APPLY_URL)).toBe('globex.eightfold.ai');
  });

  it('reads the company and role from the JobPosting JSON-LD', () => {
    document.documentElement.innerHTML = loadFixture('eightfold-form.html');
    const ctx = extractJobContext(document, new URL(APPLY_URL));
    expect(ctx.company).toBe('Globex');
    expect(ctx.role).toBe('2026101 - Controls Software Engineer');
  });

  it('falls back to the tenant subdomain for the company', () => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    expect(extractJobContext(document, new URL(APPLY_URL)).company).toBe('Globex');
  });
});
