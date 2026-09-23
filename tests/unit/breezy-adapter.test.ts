import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { breezyAdapter } from '@/adapters/breezy';
import { pickAdapter } from '@/content/detector';
import { fillField } from '@/content/filler';
import { probeAtsHint, isAtsFrameUrl } from '@/background/frames';
import { companyKeyFromUrl } from '@/profile/resume-select';
import { extractJobContext } from '@/content/job-context';
import type { DetectedField, FieldKind } from '@/adapters/types';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

function fieldNamed(fields: DetectedField[], name: string): DetectedField | undefined {
  return fields.find((f) => f.el.getAttribute('name') === name);
}

function kindOf(fields: DetectedField[], name: string): FieldKind | undefined {
  return fieldNamed(fields, name)?.kind;
}

const APPLY_URL =
  'https://tidewater-robotics.breezy.hr/p/9f21c4d70e88-firmware-engineer/apply';
const SUBMITTED_URL = `${APPLY_URL}/submitted`;

describe('breezy adapter — matches()', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('matches a breezy.hr subdomain', () => {
    expect(breezyAdapter.matches(new URL(APPLY_URL), document)).toBe(true);
  });

  it('matches an embedded form on a custom careers domain', () => {
    document.body.innerHTML =
      '<form name="form" ng-submit="apply()"><input name="cName" /></form>';
    const url = new URL('https://careers.tidewaterrobotics.dev/firmware-engineer/apply');
    expect(breezyAdapter.matches(url, document)).toBe(true);
  });

  it('does not match an unrelated page', () => {
    document.body.innerHTML = '<form name="form"><input name="email" /></form>';
    const url = new URL('https://tidewaterrobotics.dev/contact');
    expect(breezyAdapter.matches(url, document)).toBe(false);
  });

  it('is the adapter the registry picks for a breezy apply page', () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    expect(pickAdapter(new URL(APPLY_URL), document).id).toBe('breezy');
  });
});

describe('breezy adapter — detectFields() on the application step', () => {
  let fields: DetectedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    fields = breezyAdapter.detectFields(document);
  });

  it('maps the candidate fields by their Breezy names', () => {
    expect(kindOf(fields, 'cName')).toBe('fullName');
    expect(kindOf(fields, 'cEmail')).toBe('email');
    expect(kindOf(fields, 'cPhoneNumber')).toBe('phone');
    expect(kindOf(fields, 'cAddress')).toBe('cityAndRegion');
    expect(kindOf(fields, 'cSalary')).toBe('desiredSalary');
    expect(kindOf(fields, 'cCoverLetter')).toBe('coverLetter');
  });

  it('leaves the experience summary for the model rather than the profile', () => {
    expect(kindOf(fields, 'cSummary')).toBe('openEnded');
  });

  it('labels textareas from the section heading, not their empty placeholder', () => {
    expect(fieldNamed(fields, 'cSummary')?.label).toBe('Experience Summary');
    expect(fieldNamed(fields, 'cCoverLetter')?.label).toBe('Cover Letter');
  });

  it('never touches the off-screen honeypot', () => {
    expect(fields.some((f) => f.el.id === 'hp_7f2b')).toBe(false);
    const { unclassified } = breezyAdapter.detectAll!(document);
    expect(unclassified.some((u) => u.el.id === 'hp_7f2b')).toBe(false);
  });

  it('leaves the SMS consent checkbox for the candidate', () => {
    expect(fields.some((f) => f.el.getAttribute('name') === 'smsConsent')).toBe(false);
  });

  it('fills the salary amount without guessing the currency or period', () => {
    expect(fields.some((f) => f.el.getAttribute('name') === 'salaryCurrency')).toBe(false);
    const { unclassified } = breezyAdapter.detectAll!(document);
    expect(unclassified.some((u) => u.el.matches('select.salary-details'))).toBe(false);
  });

  it('picks up an education row the candidate added', () => {
    expect(fields.some((f) => f.kind === 'school')).toBe(true);
    expect(fields.some((f) => f.kind === 'fieldOfStudy')).toBe(true);
  });
});

describe('breezy adapter — questionnaire step', () => {
  let fields: DetectedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('breezy-questionnaire.html');
    fields = breezyAdapter.detectFields(document);
  });

  it('labels a question from its h3, since Breezy ships no label element', () => {
    expect(fieldNamed(fields, 'section_1780922483824_question_0')?.label).toBe(
      'What is your LinkedIn profile URL?',
    );
  });

  it('answers a work-authorization question from the profile', () => {
    expect(kindOf(fields, 'section_1780922483824_question_1')).toBe(
      'authorizedToWorkInUS',
    );
  });

  it('routes an open-ended paragraph question to the model', () => {
    const essay = fieldNamed(fields, 'section_1780922483824_question_4');
    expect(essay?.kind).toBe('openEnded');
    expect(essay?.label).toBe('Describe a bring-up you led on a new board.');
  });

  it('skips steps the wizard has not shown yet', () => {
    expect(fields.some((f) => f.el.getAttribute('name') === 'cName')).toBe(false);
    expect(fields.some((f) => f.el.getAttribute('name') === 'gender')).toBe(false);
  });

  it('surfaces a checkbox question with its option text', () => {
    const { unclassified } = breezyAdapter.detectAll!(document);
    const toolchains = unclassified.find((u) =>
      u.label.startsWith('Which firmware toolchains'),
    );
    expect(toolchains?.fieldType).toBe('checkbox');
    expect(toolchains?.options).toEqual(['Zephyr', 'FreeRTOS', 'Bare metal']);
  });

  it('surfaces a dropdown question with its options', () => {
    const { unclassified } = breezyAdapter.detectAll!(document);
    const start = unclassified.find((u) => u.label === 'How soon could you start?');
    expect(start?.fieldType).toBe('select');
    expect(start?.options).toEqual(['Immediately', 'Two weeks', 'A month or more']);
  });

  it('returns unclassified fields in DOM order', () => {
    const { unclassified } = breezyAdapter.detectAll!(document);
    for (let i = 1; i < unclassified.length; i++) {
      const rel = unclassified[i - 1]!.el.compareDocumentPosition(unclassified[i]!.el);
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe('breezy adapter — self-identification step', () => {
  let fields: DetectedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('breezy-eeoc.html');
    fields = breezyAdapter.detectFields(document);
  });

  it('classifies the EEOC groups by their model names', () => {
    expect(kindOf(fields, 'race_ethnicity')).toBe('race');
    expect(kindOf(fields, 'gender')).toBe('gender');
    expect(kindOf(fields, 'eeoc.veteran_status')).toBe('veteranStatus');
  });

  it('labels the veteran group from its heading, not the first option', () => {
    expect(fieldNamed(fields, 'eeoc.veteran_status')?.label).toBe('Veteran Status');
  });

  it('checks the radio matching the saved answer', () => {
    const veteran = fieldNamed(fields, 'eeoc.veteran_status');
    const action = fillField(veteran!, 'I am not a protected veteran', {
      forceOverwrite: false,
    });
    expect(action.status).toBe('filled');
    expect(document.querySelector<HTMLInputElement>('#vet_no')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#vet_yes')?.checked).toBe(false);
  });
});

describe('breezy adapter — resume', () => {
  it('attaches to the main attachment slot', async () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    const file = new File([new Uint8Array([7, 7])], 'cv.pdf', { type: 'application/pdf' });
    expect(await breezyAdapter.fillResume!(file, document)).toBe(true);
    const input = document.querySelector<HTMLInputElement>('#main-attachment');
    expect(input?.files?.[0]?.name).toBe('cv.pdf');
  });
});

describe('breezy adapter — getJobDescription()', () => {
  it('reads the posting body without the breadcrumbs and apply buttons', () => {
    document.documentElement.innerHTML = loadFixture('breezy-posting.html');
    const jd = breezyAdapter.getJobDescription(document);
    expect(jd).toContain('subsea inspection drone');
    expect(jd).toContain('ARM Cortex-M');
    expect(jd).not.toContain('Full-Time');
  });

  it('falls back to the banner on the apply route, which carries no posting body', () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    const jd = breezyAdapter.getJobDescription(document);
    expect(jd).toContain('Firmware Engineer');
    expect(jd).toContain('Hardware');
    expect(jd).not.toContain('Cover Letter');
    expect(jd).not.toContain('Experience Summary');
  });
});

describe('breezy adapter — detectSubmissionConfirmed()', () => {
  it('is false while the form is up and the confirmation block is still hidden', () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    expect(breezyAdapter.detectSubmissionConfirmed!(document, new URL(APPLY_URL))).toBe(
      false,
    );
  });

  it('is true on the /apply/submitted route Breezy redirects to', () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    expect(
      breezyAdapter.detectSubmissionConfirmed!(document, new URL(SUBMITTED_URL)),
    ).toBe(true);
  });

  it('is true once the in-page confirmation is shown', () => {
    document.documentElement.innerHTML = loadFixture('breezy-confirmation.html');
    expect(breezyAdapter.detectSubmissionConfirmed!(document, new URL(APPLY_URL))).toBe(
      true,
    );
  });
});

describe('breezy — frame targeting and per-company keys', () => {
  it('treats a breezy.hr subdomain as an ATS frame', () => {
    expect(isAtsFrameUrl(APPLY_URL)).toBe(true);
  });

  it('probes an embedded breezy frame by its form marker', () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    expect(probeAtsHint(document)).toBe('breezy');
  });

  it('keys the resume choice by host, since each company gets a subdomain', () => {
    expect(companyKeyFromUrl(APPLY_URL)).toBe('tidewater-robotics.breezy.hr');
  });

  it('reads the company from the subdomain and the role from the banner', () => {
    document.documentElement.innerHTML = loadFixture('breezy-form.html');
    const ctx = extractJobContext(document, new URL(APPLY_URL));
    expect(ctx.company).toBe('Tidewater Robotics');
    expect(ctx.role).toBe('Firmware Engineer');
  });
});
