import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workableAdapter } from '@/adapters/workable';
import { pickAdapter } from '@/content/detector';
import { fillField } from '@/content/filler';
import { probeAtsHint, isAtsFrameUrl } from '@/background/frames';
import { companyKeyFromUrl } from '@/profile/resume-select';
import { extractJobContext } from '@/content/job-context';
import type { DetectedField, FieldKind } from '@/adapters/types';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function kindOf(fields: DetectedField[], id: string): FieldKind | undefined {
  return fields.find((f) => f.el.id === id)?.kind;
}

const APPLY_URL = 'https://apply.workable.com/parallaxlabs/j/7F3A21C0D9/apply/';

describe('workable adapter — matches()', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('matches apply.workable.com', () => {
    expect(workableAdapter.matches(new URL(APPLY_URL), document)).toBe(true);
  });

  it('matches a custom careers domain via the application form marker', () => {
    document.body.innerHTML = '<form data-ui="application-form"></form>';
    const url = new URL('https://careers.parallaxlabs.dev/backend-engineer/apply');
    expect(workableAdapter.matches(url, document)).toBe(true);
  });

  it('does not match an unrelated page', () => {
    document.body.innerHTML = '<form><input name="email" /></form>';
    const url = new URL('https://parallaxlabs.dev/contact');
    expect(workableAdapter.matches(url, document)).toBe(false);
  });

  it('is the adapter the registry picks for a workable apply page', () => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    expect(pickAdapter(new URL(APPLY_URL), document).id).toBe('workable');
  });
});

describe('workable adapter — detectFields()', () => {
  let fields: DetectedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    fields = workableAdapter.detectFields(document);
  });

  it('maps the canonical personal-information fields', () => {
    expect(kindOf(fields, 'firstname')).toBe('firstName');
    expect(kindOf(fields, 'lastname')).toBe('lastName');
    expect(kindOf(fields, 'email')).toBe('email');
  });

  it('labels the phone field "Phone" instead of the country picker text', () => {
    const phone = fields.find((f) => f.el.getAttribute('name') === 'phone');
    expect(phone?.kind).toBe('phone');
    expect(phone?.label).toBe('Phone');
  });

  it('treats the single Address field as a location, not a street line', () => {
    expect(kindOf(fields, 'address')).toBe('cityAndRegion');
  });

  it('never touches the hidden city/postcode/country mirrors', () => {
    for (const id of ['city', 'postcode', 'country']) {
      expect(fields.some((f) => f.el.id === id)).toBe(false);
    }
  });

  it('maps the cover letter so the Suggest button can attach', () => {
    const cover = fields.find((f) => f.el.id === 'cover_letter');
    expect(cover?.kind).toBe('coverLetter');
    expect(cover?.el).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('classifies a CA_ custom attribute by its label', () => {
    expect(kindOf(fields, 'CA_4412')).toBe('desiredSalary');
  });

  it('classifies a QA_ free-text question as openEnded', () => {
    expect(kindOf(fields, 'QA_88120003')).toBe('openEnded');
  });

  it('detects the aria-hidden radio behind a role="radio" wrapper', () => {
    const relocate = fields.find((f) => f.el.id === 'relocate_yes');
    expect(relocate?.kind).toBe('willingToRelocate');
    expect(relocate?.label).toBe('Are you willing to relocate for this role?');
  });

  it('ignores a stale input.checked and still fills', () => {
    document.querySelector<HTMLInputElement>('#relocate_yes')!.checked = true;
    document.querySelector('#wrapper_relocate_yes')!.setAttribute('aria-checked', 'false');
    document.querySelector('#wrapper_relocate_no')!.setAttribute('aria-checked', 'true');

    const relocate = workableAdapter
      .detectFields(document)
      .find((f) => f.el.id === 'relocate_yes');
    expect(fillField(relocate!, 'Yes', { forceOverwrite: false }).status).toBe('filled');
  });

  it('leaves an answer the candidate already gave alone', () => {
    document.querySelector('#wrapper_relocate_yes')!.setAttribute('aria-checked', 'true');

    const relocate = workableAdapter
      .detectFields(document)
      .find((f) => f.el.id === 'relocate_yes');
    const action = fillField(relocate!, 'Yes', { forceOverwrite: false });
    expect(action.status).toBe('skipped');
    expect(action.note).toBe('already in desired state');
  });

  it('fills that radio group by clicking the aria-hidden input', () => {
    const relocate = fields.find((f) => f.el.id === 'relocate_yes');
    expect(relocate).toBeDefined();
    const action = fillField(relocate!, 'Yes', { forceOverwrite: false });
    expect(action.status).toBe('filled');
    expect(document.querySelector<HTMLInputElement>('#relocate_yes')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#relocate_no')?.checked).toBe(false);
  });
});

describe('workable adapter — detectAll()', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
  });

  it('surfaces an unmapped boolean question as a radio with its options', () => {
    const { unclassified } = workableAdapter.detectAll!(document);
    const onsite = unclassified.find(
      (u) => u.label === 'Can you be in our Boston office 3 days a week?',
    );
    expect(onsite?.fieldType).toBe('radio');
    expect(onsite?.options).toEqual(['YES', 'NO']);
  });

  it('keeps the phone country picker out of the review list', () => {
    const { unclassified } = workableAdapter.detectAll!(document);
    expect(unclassified.some((u) => /country code/i.test(u.label))).toBe(false);
  });

  it('returns unclassified fields in DOM order', () => {
    const { unclassified } = workableAdapter.detectAll!(document);
    for (let i = 1; i < unclassified.length; i++) {
      const rel = unclassified[i - 1]!.el.compareDocumentPosition(unclassified[i]!.el);
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe('workable adapter — resume', () => {
  it('attaches to the data-ui="resume" file input', async () => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    const file = new File([new Uint8Array([7, 7])], 'cv.pdf', { type: 'application/pdf' });
    expect(await workableAdapter.fillResume!(file, document)).toBe(true);
    const input = document.querySelector<HTMLInputElement>('[data-ui="resume"]');
    expect(input?.files?.[0]?.name).toBe('cv.pdf');
  });
});

describe('workable adapter — getJobDescription()', () => {
  it('joins description, requirements and benefits on the posting page', () => {
    document.documentElement.innerHTML = loadFixture('workable-posting.html');
    const jd = workableAdapter.getJobDescription(document);
    expect(jd).toContain('90 second freshness budget');
    expect(jd).toContain('production Go or Rust');
    expect(jd).toContain('hardware budget');
  });

  it('falls back to the job header on the apply route, not the form labels', () => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    const jd = workableAdapter.getJobDescription(document);
    expect(jd).toContain('Backend Engineer');
    expect(jd).toContain('Platform');
    expect(jd).not.toContain('Cover letter');
    expect(jd).not.toContain('salary expectations');
  });
});

describe('workable adapter — detectSubmissionConfirmed()', () => {
  it('is false while the application form is still on the page', () => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    expect(workableAdapter.detectSubmissionConfirmed!(document, new URL(APPLY_URL))).toBe(
      false,
    );
  });

  it('is true on the thank-you page with the EEO survey', () => {
    document.documentElement.innerHTML = loadFixture('workable-confirmation.html');
    expect(workableAdapter.detectSubmissionConfirmed!(document, new URL(APPLY_URL))).toBe(
      true,
    );
  });
});

describe('workable — frame targeting and per-company keys', () => {
  it('treats apply.workable.com as an ATS frame', () => {
    expect(isAtsFrameUrl(APPLY_URL)).toBe(true);
  });

  it('probes an embedded workable frame by its form marker', () => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    expect(probeAtsHint(document)).toBe('workable');
  });

  it('keys the resume choice per company on the shared host', () => {
    expect(companyKeyFromUrl(APPLY_URL)).toBe('apply.workable.com/parallaxlabs');
  });

  it('reads the company from the account segment of the apply URL', () => {
    document.documentElement.innerHTML = loadFixture('workable-form.html');
    const ctx = extractJobContext(document, new URL(APPLY_URL));
    expect(ctx.company).toBe('Parallaxlabs');
    expect(ctx.role).toBe('Backend Engineer');
  });
});
