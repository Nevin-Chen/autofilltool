import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { greenhouseAdapter } from '@/adapters/greenhouse';
import { leverAdapter } from '@/adapters/lever';
import { ashbyAdapter } from '@/adapters/ashby';
import { workdayAdapter } from '@/adapters/workday';
import { genericAdapter } from '@/adapters/generic';
import { pickAdapter } from '@/content/detector';
import { JOB_DESCRIPTION_CHAR_BUDGET, fromKeywords, normalize } from '@/adapters/_shared';
import type { FieldKind, DetectedField } from '@/adapters/types';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function find(fields: DetectedField[], pred: (el: HTMLElement) => boolean) {
  return fields.find((f) => pred(f.el));
}

describe('adapter matches()', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('greenhouse matches boards.greenhouse.io', () => {
    const url = new URL('https://boards.greenhouse.io/acme/jobs/1');
    expect(greenhouseAdapter.matches(url, document)).toBe(true);
  });

  it('greenhouse matches via #application-form on custom domains', () => {
    document.body.innerHTML = '<form id="application-form"></form>';
    const url = new URL('https://careers.foo.com/apply');
    expect(greenhouseAdapter.matches(url, document)).toBe(true);
  });

  it('greenhouse matches via #grnhse_iframe on a company page', () => {
    document.body.innerHTML =
      '<div id="grnhse_app"><iframe id="grnhse_iframe" src="https://job-boards.greenhouse.io/embed/job_app?for=acme"></iframe></div>';
    const url = new URL('https://acme.com/careers/jobs/123');
    expect(greenhouseAdapter.matches(url, document)).toBe(true);
  });

  it('greenhouse matches job-boards.greenhouse.io (new redesign host)', () => {
    const url = new URL(
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123',
    );
    expect(greenhouseAdapter.matches(url, document)).toBe(true);
  });

  it('lever matches jobs.lever.co', () => {
    const url = new URL('https://jobs.lever.co/acme-bio/abcd-1234/apply');
    expect(leverAdapter.matches(url, document)).toBe(true);
  });

  it('ashby matches jobs.ashbyhq.com', () => {
    const url = new URL('https://jobs.ashbyhq.com/globex/posting/xyz');
    expect(ashbyAdapter.matches(url, document)).toBe(true);
  });

  it('workday matches *.myworkdayjobs.com', () => {
    const url = new URL('https://acme.wd5.myworkdayjobs.com/External/job/123');
    expect(workdayAdapter.matches(url, document)).toBe(true);
  });

  it('workday matches via data-automation-id on custom domains', () => {
    document.body.innerHTML = '<input data-automation-id="firstName" />';
    const url = new URL('https://careers.acme.com/apply');
    expect(workdayAdapter.matches(url, document)).toBe(true);
  });

  it('detector picks the right adapter per host', () => {
    expect(pickAdapter(new URL('https://boards.greenhouse.io/x'), document).id).toBe(
      'greenhouse',
    );
    expect(pickAdapter(new URL('https://jobs.lever.co/x'), document).id).toBe('lever');
    expect(pickAdapter(new URL('https://jobs.ashbyhq.com/x'), document).id).toBe('ashby');
    expect(pickAdapter(new URL('https://example.com/'), document).id).toBe('generic');
  });
});

describe('fromKeywords — rule precedence under collisions', () => {
  it.each<[string, FieldKind]>([
    [
      "Will you now or will you in the future require employment visa sponsorship to work in the country in which the job you're applying for is located?",
      'requiresSponsorship',
    ],
    [
      'What is the address from which you plan on working? If you would need to relocate, please type "relocating".',
      'addressLine1',
    ],
  ])('%s → %s', (label, kind) => {
    expect(fromKeywords(normalize(label))?.kind).toBe(kind);
  });
});

describe('greenhouseAdapter — fixture', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('greenhouse-form.html');
  });

  it('classifies canonical fields with very high confidence', () => {
    const fields = greenhouseAdapter.detectFields(document);
    const expected: Array<[string, FieldKind]> = [
      ['first_name', 'firstName'],
      ['last_name', 'lastName'],
      ['email', 'email'],
      ['phone', 'phone'],
    ];
    for (const [id, kind] of expected) {
      const f = find(fields, (el) => el.id === id);
      expect(f, `missing field for ${id}`).toBeDefined();
      expect(f?.kind).toBe(kind);
      expect(f?.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('classifies LinkedIn/GitHub custom-question inputs via label hints', () => {
    const fields = greenhouseAdapter.detectFields(document);
    const linkedin = fields.find((f) => f.kind === 'linkedin');
    const github = fields.find((f) => f.kind === 'github');
    expect(linkedin?.label).toMatch(/LinkedIn/i);
    expect(github?.label).toMatch(/GitHub/i);
  });

  it('finds the work-auth radio group via the fieldset legend', () => {
    const fields = greenhouseAdapter.detectFields(document);
    const auth = fields.filter((f) => f.kind === 'authorizedToWorkInUS');
    expect(auth.length).toBeGreaterThan(0);
  });

  it('fillResume targets #resume', async () => {
    const file = new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' });
    const ok = await greenhouseAdapter.fillResume!(file, document);
    expect(ok).toBe(true);
    const resume = document.getElementById('resume') as HTMLInputElement;
    expect(resume.files?.[0]?.name).toBe('cv.pdf');
  });
});

describe('greenhouseAdapter — new redesign fixture', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('greenhouse-embed-new.html');
  });

  it('classifies canonical fields by name even with no stable ids', () => {
    const fields = greenhouseAdapter.detectFields(document);
    const expected: Array<[string, FieldKind]> = [
      ['first_name', 'firstName'],
      ['last_name', 'lastName'],
      ['email', 'email'],
      ['phone', 'phone'],
    ];
    for (const [name, kind] of expected) {
      const f = find(fields, (el) => (el as HTMLInputElement).name === name);
      expect(f, `missing field for name="${name}"`).toBeDefined();
      expect(f?.kind).toBe(kind);
      expect(f?.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('classifies the LinkedIn URL question via label hint', () => {
    const fields = greenhouseAdapter.detectFields(document);
    const linkedin = fields.find((f) => f.kind === 'linkedin');
    expect(linkedin).toBeDefined();
    expect(linkedin?.label).toMatch(/LinkedIn/i);
  });

  it('fillResume targets the hidden file input by name', async () => {
    const file = new File([new Uint8Array([9])], 'cv.pdf', { type: 'application/pdf' });
    const ok = await greenhouseAdapter.fillResume!(file, document);
    expect(ok).toBe(true);
    const resume = document.querySelector<HTMLInputElement>(
      'input[type="file"][name="resume"]',
    );
    expect(resume?.files?.[0]?.name).toBe('cv.pdf');
  });

  it('marks Yes/No combobox triggers as virtualizedDropdown so the async filler runs', () => {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.id = 'auth-q';
    label.textContent = 'Are you legally authorized to work in the United States?';
    const trigger = document.createElement('button');
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-labelledby', 'auth-q');
    trigger.textContent = 'Select...';
    wrap.append(label, trigger);
    document.body.appendChild(wrap);

    const fields = greenhouseAdapter.detectFields(document);
    const combo = fields.find((f) => f.el === trigger);
    expect(combo, 'combobox trigger should be detected').toBeDefined();
    expect(combo?.widget).toBe('virtualizedDropdown');
    expect(combo?.kind).toBe('authorizedToWorkInUS');
  });

  it('marks an <input role="combobox"> (react-select) as virtualizedDropdown — not a plain text field', () => {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.id = 'question_17768983004-label';
    label.textContent = 'Do you require visa sponsorship?';
    const input = document.createElement('input');
    input.id = 'question_17768983004';
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-labelledby', 'question_17768983004-label');
    input.setAttribute('aria-controls', 'react-select-question_17768983004-listbox');
    wrap.append(label, input);
    document.body.appendChild(wrap);

    const fields = greenhouseAdapter.detectFields(document);
    const combo = fields.find((f) => f.el === input);
    expect(combo, 'react-select input should be detected').toBeDefined();
    expect(combo?.widget).toBe('virtualizedDropdown');
    expect(combo?.kind).toBe('requiresSponsorship');
  });

  it("returns fields in DOM order (so review-pane navigation goes top-to-bottom)", () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label>
        <input type="email" id="email" name="email" />
        <label for="first_name">First</label>
        <input type="text" id="first_name" name="first_name" />
        <label for="addr-country">Country</label>
        <input role="combobox" type="text" id="addr-country" />
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const ids = fields.map((f) => f.el.id);
    expect(ids.indexOf('email')).toBeLessThan(ids.indexOf('first_name'));
    expect(ids.indexOf('first_name')).toBeLessThan(ids.indexOf('addr-country'));
  });

  it("does not detect the phone-input country-code picker as kind=country", () => {
    document.body.innerHTML = `
      <form>
        <div class="phone-input__country">
          <div class="select">
            <div class="select__container">
              <label id="country-label" for="country">Country</label>
              <div class="select-shell">
                <div>
                  <div class="select__control">
                    <div class="select__value-container">
                      <div class="select__input-container">
                        <input role="combobox" type="text" id="country"
                               aria-labelledby="country-label" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <input type="tel" name="phone" />
        <div>
          <label for="addr-country">Country</label>
          <input role="combobox" type="text" id="addr-country"
                 aria-labelledby="addr-country-label" />
          <label id="addr-country-label" hidden>Country</label>
        </div>
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const country = fields.filter((f) => f.kind === 'country');
    expect(country.length, 'exactly one country field (the address one)').toBe(1);
    expect(country[0]?.el.id).toBe('addr-country');
  });

  it("deduplicates the same kind across the combobox walk and the input walk (country shouldn't appear as both filled and skipped)", () => {
    document.body.innerHTML = `
      <form>
        <div>
          <label>Country *</label>
          <input role="combobox" type="text" name="country_search" />
          <input type="text" name="country" />
        </div>
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const country = fields.filter((f) => f.kind === 'country');
    expect(country.length, 'country should appear exactly once').toBe(1);
    expect(country[0]?.widget).toBe('virtualizedDropdown');
  });

  it("deduplicates nested role='combobox' / aria-haspopup wrappers (only innermost wins)", () => {
    document.body.innerHTML = `
      <form>
        <div>
          <label>Country *</label>
          <div role="combobox" aria-haspopup="listbox">
            <div class="select__input-container">
              <input role="combobox" type="text" name="country" />
            </div>
          </div>
        </div>
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const country = fields.filter((f) => f.kind === 'country');
    expect(country.length, 'should produce exactly one country field').toBe(1);
    expect(country[0]?.el.tagName.toLowerCase()).toBe('input');
    expect(country[0]?.widget).toBe('virtualizedDropdown');
  });

  it("keeps virtualizedDropdown widget when a Yes/No combobox uses a positional <label> (no aria-labelledby)", () => {
    document.body.innerHTML = `
      <form>
        <div>
          <label>Are you legally authorized to work in the United States?</label>
          <div class="select__input-container">
            <input role="combobox" type="text" name="q_auth" />
          </div>
        </div>
        <div>
          <label>Other question</label>
          <input type="text" name="other" />
        </div>
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const combo = fields.find((f) => f.kind === 'authorizedToWorkInUS');
    expect(combo, 'work-auth combobox must be detected').toBeDefined();
    expect(combo?.widget).toBe('virtualizedDropdown');
  });

  it("ignores Google reCAPTCHA's hidden <textarea id='g-recaptcha-response'>", () => {
    document.body.innerHTML = `
      <form>
        <input name="first_name" type="text" />
        <div>
          <textarea id="g-recaptcha-response" name="g-recaptcha-response"
                    style="display: none;"></textarea>
        </div>
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const captcha = fields.find(
      (f) => f.el instanceof HTMLTextAreaElement && f.el.id === 'g-recaptcha-response',
    );
    expect(captcha, 'reCAPTCHA hidden textarea must not be detected').toBeUndefined();
  });

  it("does not steal a purely-positional <label> (no for/id) from a sibling field", () => {
    document.body.innerHTML = `
      <form>
        <div class="question">
          <label>Phone *</label>
          <input name="phone" type="tel" />
        </div>
        <div class="question">
          <textarea name="extra"></textarea>
        </div>
      </form>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const phone = fields.find((f) => f.kind === 'phone');
    expect(phone?.label).toBe('Phone *');

    const textarea = document.querySelector('textarea')!;
    const textareaField = fields.find((f) => f.el === textarea);
    expect(textareaField?.label).not.toBe('Phone *');
  });

  it("does not steal a sibling field's label for an unlabelled textarea (the 'First Name *' duplication bug)", () => {
    document.body.innerHTML = `
      <div>
        <div>
          <label id="fn-label">First Name *</label>
          <input name="first_name" id="first_name" type="text"
                 aria-labelledby="fn-label" />
        </div>
        <div>
          <textarea name="extra_info"></textarea>
        </div>
      </div>
    `;

    const fields = greenhouseAdapter.detectFields(document);
    const firstName = fields.find((f) => f.kind === 'firstName');
    expect(firstName?.label).toBe('First Name *');

    const textarea = document.querySelector('textarea')!;
    const textareaField = fields.find((f) => f.el === textarea);
    expect(textareaField?.label).not.toBe('First Name *');
  });
});

describe('leverAdapter — fixture', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('lever-form.html');
  });

  it('classifies canonical name-attribute fields', () => {
    const fields = leverAdapter.detectFields(document);
    const expected: Array<[string, FieldKind]> = [
      ['name', 'fullName'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['urls[LinkedIn]', 'linkedin'],
      ['urls[GitHub]', 'github'],
      ['urls[Portfolio]', 'portfolio'],
    ];
    for (const [name, kind] of expected) {
      const f = find(fields, (el) => (el as HTMLInputElement).name === name);
      expect(f, `missing field for name="${name}"`).toBeDefined();
      expect(f?.kind).toBe(kind);
      expect(f?.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('finds the open-ended Why textarea via heuristic fallback', () => {
    const fields = leverAdapter.detectFields(document);
    const why = fields.find(
      (f) => f.kind === 'openEnded' && (f.el as HTMLTextAreaElement).id === 'why',
    );
    expect(why).toBeDefined();
  });

  it('fillResume targets name="resume"', async () => {
    const file = new File([new Uint8Array([1, 2])], 'cv.pdf', { type: 'application/pdf' });
    const ok = await leverAdapter.fillResume!(file, document);
    expect(ok).toBe(true);
    const input = document.querySelector<HTMLInputElement>('input[name="resume"]');
    expect(input?.files?.[0]?.name).toBe('cv.pdf');
  });
});

describe('ashbyAdapter — fixture', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('ashby-form.html');
  });

  it('classifies FieldEntry blocks via FieldLabel text', () => {
    const fields = ashbyAdapter.detectFields(document);
    const labels = new Map(fields.map((f) => [f.label, f.kind] as const));
    expect(labels.get('Full name')).toBe('fullName');
    expect(labels.get('Email')).toBe('email');
    expect(labels.get('Phone')).toBe('phone');
    expect(labels.get('LinkedIn')).toBe('linkedin');
    expect(labels.get('GitHub')).toBe('github');
  });

  it('classifies the open-ended question as openEnded', () => {
    const fields = ashbyAdapter.detectFields(document);
    const why = fields.find((f) => f.label.startsWith('Why'));
    expect(why?.kind).toBe('openEnded');
  });

  it('fillResume picks the file input inside the Resume FieldEntry', async () => {
    const file = new File([new Uint8Array([3])], 'cv.pdf', { type: 'application/pdf' });
    const ok = await ashbyAdapter.fillResume!(file, document);
    expect(ok).toBe(true);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.files?.[0]?.name).toBe('cv.pdf');
  });

  it('classifies a single-token "Name" FieldEntry as fullName', () => {
    const fields = ashbyAdapter.detectFields(document);
    const f = fields.find(
      (x) => x.el === document.querySelector('input[name="customfield_name_single"]'),
    );
    expect(f, 'single-Name field should be detected').toBeDefined();
    expect(f?.kind).toBe('fullName');
  });

  it('does not misclassify FieldEntry labels that merely contain "name" (e.g. "Company name") as fullName', () => {
    document.documentElement.innerHTML = `
      <div>
        <div data-testid="FieldEntry">
          <div data-testid="FieldLabel">Company name</div>
          <input data-testid="InputField" name="customfield_company" type="text" />
        </div>
      </div>
    `;
    const fields = ashbyAdapter.detectFields(document);
    const f = fields.find(
      (x) => x.el === document.querySelector('input[name="customfield_company"]'),
    );
    expect(f?.kind).not.toBe('fullName');
  });

  it('classifies a [data-field-entry-id] Name input as fullName', () => {
    const fields = ashbyAdapter.detectFields(document);
    const f = fields.find((x) => x.el === document.getElementById('live-name-input'));
    expect(f?.kind).toBe('fullName');
  });

  it('classifies an "Address (City & State)" input as cityAndRegion (not addressLine1)', () => {
    const fields = ashbyAdapter.detectFields(document);
    const f = fields.find(
      (x) => x.el === document.getElementById('live-address-citystate-input'),
    );
    expect(f?.kind).toBe('cityAndRegion');
  });

  it('detects radio-group FieldEntries (live DOM): exactly one DetectedField per group, first radio as representative', () => {
    const fields = ashbyAdapter.detectFields(document);
    const cases: Array<[string, FieldKind, string]> = [
      ['live-sponsorship-yes', 'requiresSponsorship', 'live-sponsorship'],
      ['live-relocation-yes', 'willingToRelocate', 'live-relocation'],
      ['live-race-0', 'race', 'live-race'],
      ['live-disability-0', 'disabilityStatus', 'live-disability'],
    ];
    for (const [repId, kind, name] of cases) {
      const rep = document.getElementById(repId);
      const groupFields = fields.filter(
        (x) =>
          x.el instanceof HTMLInputElement &&
          x.el.type === 'radio' &&
          x.el.name === name,
      );
      expect(groupFields.length, `exactly one DetectedField for radio group ${name}`).toBe(1);
      expect(groupFields[0]?.kind, `kind for ${name}`).toBe(kind);
      expect(groupFields[0]?.el, `representative radio for ${name}`).toBe(rep);
    }
  });

  it('classifies a "we don\'t provide relocation ... able to commute" question as willingToRelocate', () => {
    const fields = ashbyAdapter.detectFields(document);
    const groupFields = fields.filter(
      (x) =>
        x.el instanceof HTMLInputElement && x.el.type === 'radio' && x.el.name === 'live-commute',
    );
    expect(groupFields.length).toBe(1);
    expect(groupFields[0]?.kind).toBe('willingToRelocate');
  });
});

describe('workdayAdapter — fixture', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('workday-form.html');
  });

  it('classifies data-automation-id inputs to canonical kinds', () => {
    const fields = workdayAdapter.detectFields(document);
    const expected: Array<[string, FieldKind]> = [
      ['firstName', 'firstName'],
      ['lastName', 'lastName'],
      ['email', 'email'],
      ['phone-input', 'phone'],
      ['addressLine1', 'addressLine1'],
      ['city', 'city'],
      ['postalCode', 'postalCode'],
    ];
    for (const [automationId, kind] of expected) {
      const f = find(
        fields,
        (el) => el.getAttribute('data-automation-id') === automationId,
      );
      expect(f, `missing field for ${automationId}`).toBeDefined();
      expect(f?.kind).toBe(kind);
      expect(f?.confidence).toBeGreaterThanOrEqual(0.85);
      expect(f?.widget).not.toBe('virtualizedDropdown');
    }
  });

  it('marks the Country combobox as a virtualizedDropdown widget', () => {
    const fields = workdayAdapter.detectFields(document);
    const country = find(
      fields,
      (el) => el.getAttribute('data-automation-id') === 'countryDropdown',
    );
    expect(country).toBeDefined();
    expect(country?.kind).toBe('country');
    expect(country?.widget).toBe('virtualizedDropdown');
  });

  it('fillResume targets the file-upload-input-ref', async () => {
    const file = new File([new Uint8Array([1, 2])], 'cv.pdf', { type: 'application/pdf' });
    const ok = await workdayAdapter.fillResume!(file, document);
    expect(ok).toBe(true);
    const input = document.querySelector<HTMLInputElement>(
      'input[data-automation-id="file-upload-input-ref"]',
    );
    expect(input?.files?.[0]?.name).toBe('cv.pdf');
  });

  it('getJobDescription pulls the jobPostingDescription block', () => {
    const text = workdayAdapter.getJobDescription(document);
    expect(text).toMatch(/lead service migrations/);
    expect(text).toMatch(/5\+ years backend/);
  });
});

describe('getJobDescription', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head><title>t</title></head><body></body>';
  });

  it('greenhouse pulls the #content section when present', () => {
    document.body.innerHTML = `
      <header>nav junk</header>
      <div id="content">
        <h1>Senior Engineer at Acme</h1>
        <p>You'll lead the platform team and ship infra.</p>
        <p>Requirements: 5+ years backend.</p>
      </div>
      <form id="application-form"><input name="first_name"/></form>
    `;
    const text = greenhouseAdapter.getJobDescription(document);
    expect(text).toMatch(/lead the platform team/);
    expect(text).toMatch(/Requirements: 5\+ years backend/);
    expect(text).not.toMatch(/nav junk/);
  });

  it('greenhouse falls back to body text when no #content', () => {
    document.body.innerHTML = '<p>Just some plain page body text about the role.</p>';
    const text = greenhouseAdapter.getJobDescription(document);
    expect(text).toMatch(/plain page body text/);
  });

  it('lever pulls .posting-page .content', () => {
    document.body.innerHTML = `
      <div class="posting-page">
        <div class="content">
          <h2>About this role</h2>
          <p>You'll join a small team building dev tools.</p>
        </div>
      </div>
    `;
    const text = leverAdapter.getJobDescription(document);
    expect(text).toMatch(/About this role/);
    expect(text).toMatch(/dev tools/);
  });

  it('ashby pulls [data-testid="JobPostingDescription"]', () => {
    document.body.innerHTML = `
      <div data-testid="JobPostingDescription">
        <p>Ashby is hiring an engineer to work on the recruiting platform.</p>
      </div>
    `;
    const text = ashbyAdapter.getJobDescription(document);
    expect(text).toMatch(/recruiting platform/);
  });

  it('generic uses Readability when the page looks article-ish', () => {
    const body = Array(20)
      .fill(
        '<p>This is a long-form article paragraph describing the role with enough text to satisfy Readability heuristics. The candidate will lead initiatives and ship features.</p>',
      )
      .join('\n');
    document.body.innerHTML = `<article>${body}</article>`;
    const text = genericAdapter.getJobDescription(document);
    expect(text.length).toBeGreaterThan(100);
    expect(text).toMatch(/lead initiatives/);
  });

  it('generic falls back to <main> when Readability bails', () => {
    document.body.innerHTML = '<main><p>Short page body.</p></main>';
    const text = genericAdapter.getJobDescription(document);
    expect(text).toMatch(/Short page body/);
  });

  it('clips to the JD char budget', () => {
    const big = 'A'.repeat(JOB_DESCRIPTION_CHAR_BUDGET * 3);
    document.body.innerHTML = `<div id="content">${big}</div>`;
    const text = greenhouseAdapter.getJobDescription(document);
    expect(text.length).toBeLessThanOrEqual(JOB_DESCRIPTION_CHAR_BUDGET);
    expect(text).toMatch(/A+…$/);
  });

  it('returns "" gracefully on an empty document', () => {
    expect(genericAdapter.getJobDescription(document)).toBe('');
  });
});
