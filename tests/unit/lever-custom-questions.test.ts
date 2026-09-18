import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { leverAdapter } from '@/adapters/lever';
import { isRequiredField } from '@/adapters/_shared';
import { fillField } from '@/content/filler';
import { valueForField } from '@/content/mapping';
import { emptyProfile, type Profile } from '@/profile/schema';

const SPONSORSHIP = 'cards[5410080d-2b28-4612-ad07-69319ed7afda][field1]';
const ELIGIBLE = 'cards[5410080d-2b28-4612-ad07-69319ed7afda][field0]';
const REFERRED = 'cards[6a99c440-b52f-4eb9-9516-7ca4b6d02d63][field0]';
const HYBRID = 'cards[55992e94-abfa-4460-a730-ea6964993fdf][field0]';
const SOURCE = 'cards[8d1f2c3a-0000-4000-8000-000000000001][field0]';
const REFERRER_NAME = 'cards[3246e883-7983-495e-93b5-6531e6be8609][field0]';

const byName = (name: string) =>
  document.querySelector<HTMLElement>(`[name="${name}"]`)!;
const radios = (name: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`));

function profileWithWorkAuth(over: Partial<Profile['workAuth']>): Profile {
  const p = emptyProfile();
  return { ...p, workAuth: { ...p.workAuth, ...over } };
}

describe('lever custom multiple-choice questions', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = readFileSync(
      resolve(__dirname, '../e2e/fixtures/lever-custom-questions.html'),
      'utf8',
    );
  });

  it('labels each radio group with its question, not the option it wraps', () => {
    const { unclassified } = leverAdapter.detectAll!(document);
    const labelFor = (name: string) =>
      unclassified.find((u) => u.el.getAttribute('name') === name)?.label;
    expect(labelFor(REFERRED)).toMatch(/^Were you referred by a current Lendbuzz employee/);
    expect(labelFor(HYBRID)).toMatch(/^This position requires three/);
    expect(labelFor(SOURCE)).toMatch(/^How did you hear about this role/);
    for (const u of unclassified) expect(u.label).not.toMatch(/^(yes|no)$/i);
  });

  it('classifies the sponsorship and eligibility questions so the profile answers them', () => {
    const kinds = new Map(
      leverAdapter.detectFields(document).map((f) => [f.el.getAttribute('name'), f.kind]),
    );
    expect(kinds.get(SPONSORSHIP)).toBe('requiresSponsorship');
    expect(kinds.get(ELIGIBLE)).toBe('authorizedToWorkInUS');
    expect(kinds.has(REFERRED)).toBe(false);
  });

  it('detects each radio group once, not once per option', () => {
    const names = leverAdapter
      .detectFields(document)
      .map((f) => f.el.getAttribute('name'))
      .filter((n) => n === SPONSORSHIP || n === ELIGIBLE);
    expect(names).toEqual([ELIGIBLE, SPONSORSHIP]);
  });

  it('keeps the sponsorship radios out of the AI queue once classified', () => {
    const { unclassified } = leverAdapter.detectAll!(document);
    const names = unclassified.map((u) => u.el.getAttribute('name'));
    expect(names).not.toContain(SPONSORSHIP);
    expect(names).not.toContain(ELIGIBLE);
    expect(names).toContain(REFERRED);
  });

  it('answers No to sponsorship and Yes to eligibility from the saved profile', () => {
    const profile = profileWithWorkAuth({
      authorizedToWorkInUS: true,
      requiresSponsorship: false,
    });
    const fields = leverAdapter.detectFields(document);
    const sponsorship = fields.find((f) => f.el.getAttribute('name') === SPONSORSHIP)!;
    const eligible = fields.find((f) => f.el.getAttribute('name') === ELIGIBLE)!;

    fillField(sponsorship, valueForField(profile, sponsorship.kind, sponsorship.label), {
      forceOverwrite: false,
      suppressFlash: true,
    });
    fillField(eligible, valueForField(profile, eligible.kind, eligible.label), {
      forceOverwrite: false,
      suppressFlash: true,
    });

    expect(radios(SPONSORSHIP).find((r) => r.checked)?.value).toBe('No');
    expect(radios(ELIGIBLE).find((r) => r.checked)?.value).toBe('Yes');
  });

  it('leaves both work-auth radios untouched when the profile has no answer', () => {
    const profile = emptyProfile();
    const fields = leverAdapter.detectFields(document);
    const sponsorship = fields.find((f) => f.el.getAttribute('name') === SPONSORSHIP)!;
    const action = fillField(
      sponsorship,
      valueForField(profile, sponsorship.kind, sponsorship.label),
      { forceOverwrite: false, suppressFlash: true },
    );
    expect(action.status).toBe('skipped');
    expect(radios(SPONSORSHIP).some((r) => r.checked)).toBe(false);
  });
});

describe('isRequiredField on lever markup', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = readFileSync(
      resolve(__dirname, '../e2e/fixtures/lever-custom-questions.html'),
      'utf8',
    );
  });

  it('reads the required attribute off native inputs and radio groups', () => {
    expect(isRequiredField(byName('name'))).toBe(true);
    expect(isRequiredField(byName('email'))).toBe(true);
    expect(isRequiredField(radios(REFERRED)[0]!)).toBe(true);
    expect(isRequiredField(radios(SPONSORSHIP)[1]!)).toBe(true);
    expect(isRequiredField(byName(REFERRER_NAME))).toBe(true);
  });

  it('treats fields with no marker as optional', () => {
    expect(isRequiredField(byName('org'))).toBe(false);
    expect(isRequiredField(byName('urls[Twitter]'))).toBe(false);
    expect(isRequiredField(byName('urls[LinkedIn]'))).toBe(false);
    expect(isRequiredField(radios(SOURCE)[0]!)).toBe(false);
  });
});

describe('isRequiredField on other ATS markup', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('honours aria-required and a trailing asterisk in the label', () => {
    document.body.innerHTML = `
      <form>
        <label for="first">First Name<span class="required-marker">*</span></label>
        <input id="first" type="text" aria-required="true" />
        <label for="pref">Preferred name</label>
        <input id="pref" type="text" />
        <label for="school">School *</label>
        <input id="school" type="text" />
      </form>
    `;
    expect(isRequiredField(document.getElementById('first')!)).toBe(true);
    expect(isRequiredField(document.getElementById('pref')!)).toBe(false);
    expect(isRequiredField(document.getElementById('school')!, 'School *')).toBe(true);
  });

  it('spots a Workday-style abbr marker inside the question', () => {
    document.body.innerHTML = `
      <div data-automation-id="formField-country">
        <label data-automation-id="formLabel"><abbr title="required">*</abbr>Country</label>
        <select id="country"><option>United States</option></select>
      </div>
      <div data-automation-id="formField-nickname">
        <label data-automation-id="formLabel">Nickname</label>
        <input id="nick" type="text" />
      </div>
    `;
    expect(isRequiredField(document.getElementById('country')!)).toBe(true);
    expect(isRequiredField(document.getElementById('nick')!)).toBe(false);
  });

  it('does not borrow a neighbouring question\'s marker', () => {
    document.body.innerHTML = `
      <form>
        <div class="q">
          <label for="a">Desired salary<span class="required">*</span></label>
          <input id="a" type="text" required />
        </div>
        <div class="q">
          <label for="b">Anything else?</label>
          <textarea id="b"></textarea>
        </div>
      </form>
    `;
    expect(isRequiredField(document.getElementById('a')!)).toBe(true);
    expect(isRequiredField(document.getElementById('b')!)).toBe(false);
  });
});
