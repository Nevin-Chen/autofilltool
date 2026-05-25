import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { greenhouseAdapter } from '@/adapters/greenhouse';
import { leverAdapter } from '@/adapters/lever';
import { ashbyAdapter } from '@/adapters/ashby';
import { pickAdapter } from '@/content/detector';
import type { FieldKind, DetectedField } from '@/adapters/types';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

/** Find a detected field by predicate. */
function find(fields: DetectedField[], pred: (el: HTMLElement) => boolean) {
  return fields.find((f) => pred(f.el));
}

/* -------------------------------------------------------- matches() */

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

  it('lever matches jobs.lever.co', () => {
    const url = new URL('https://jobs.lever.co/acme-bio/abcd-1234/apply');
    expect(leverAdapter.matches(url, document)).toBe(true);
  });

  it('ashby matches jobs.ashbyhq.com', () => {
    const url = new URL('https://jobs.ashbyhq.com/globex/posting/xyz');
    expect(ashbyAdapter.matches(url, document)).toBe(true);
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

/* -------------------------------------------------------- Greenhouse */

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

/* -------------------------------------------------------- Lever */

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

/* -------------------------------------------------------- Ashby */

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
