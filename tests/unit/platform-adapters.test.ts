import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { greenhouseAdapter } from '@/adapters/greenhouse';
import { leverAdapter } from '@/adapters/lever';
import { ashbyAdapter } from '@/adapters/ashby';
import { workdayAdapter } from '@/adapters/workday';
import { genericAdapter } from '@/adapters/generic';
import { pickAdapter } from '@/content/detector';
import { JOB_DESCRIPTION_CHAR_BUDGET } from '@/adapters/_shared';
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
