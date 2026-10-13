import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gemAdapter } from '@/adapters/gem';
import { pickAdapter } from '@/content/detector';
import {
  fillCheckboxGroup,
  fillField,
  fillMenuButton,
  harvestMenuButtonOptions,
} from '@/content/filler';
import { isAtsFrameUrl } from '@/background/frames';
import { companyKeyFromUrl } from '@/profile/resume-select';
import { extractJobContext } from '@/content/job-context';
import { unclassifiedFromDetected } from '@/adapters/_shared';
import type { DetectedField } from '@/adapters/types';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

const POSTING_URL = 'https://jobs.gem.com/globex/am9icG9zdDpExample';

function fieldLabelled(fields: DetectedField[], start: string): DetectedField | undefined {
  return fields.find((f) => f.label.startsWith(start));
}

function textInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'));
}

function menuButton(label: string): HTMLButtonElement {
  const title = Array.from(document.querySelectorAll('.field-163 > div')).find(
    (el) => el.textContent?.trim() === label,
  );
  const button = title?.nextElementSibling;
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no menu button for ${label}`);
  return button;
}

function mountFloatingMenu(button: HTMLButtonElement, options: string[]): void {
  const portal = document.getElementById('floating-ui-portal')!;
  const close = () => {
    portal.innerHTML = '';
  };
  button.addEventListener('click', () => {
    if (portal.querySelector('menu')) return close();
    const menu = document.createElement('menu');
    for (const text of options) {
      const item = document.createElement('li');
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `<div><div>${text}</div></div>`;
      item.addEventListener('click', () => {
        button.firstElementChild!.textContent = text;
        close();
      });
      menu.append(item);
    }
    portal.append(menu);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

describe('gem adapter — matches()', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('matches a jobs.gem.com posting', () => {
    expect(gemAdapter.matches(new URL(POSTING_URL), document)).toBe(true);
  });

  it('matches a form that carries the Powered by Gem logo on another domain', () => {
    document.body.innerHTML = '<img alt="Gem Logo" src="data:," />';
    expect(gemAdapter.matches(new URL('https://careers.globex.dev/jobs/42'), document)).toBe(true);
  });

  it('does not match an unrelated page', () => {
    expect(gemAdapter.matches(new URL('https://www.gem.com/pricing'), document)).toBe(false);
  });

  it('is the adapter the registry picks for a Gem posting', () => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
    expect(pickAdapter(new URL(POSTING_URL), document).id).toBe('gem');
  });
});

describe('gem adapter — detectFields()', () => {
  let fields: DetectedField[];

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
    fields = gemAdapter.detectFields(document);
  });

  it('labels each text input from the span before its wrapper', () => {
    const [first, last, email, linkedin, phone, location] = textInputs();
    const byEl = (el: HTMLElement | undefined) => fields.find((f) => f.el === el);
    expect(byEl(first)).toMatchObject({ kind: 'firstName', label: 'First name *' });
    expect(byEl(last)).toMatchObject({ kind: 'lastName', label: 'Last name *' });
    expect(byEl(email)?.kind).toBe('email');
    expect(byEl(linkedin)?.kind).toBe('linkedin');
    expect(byEl(phone)?.kind).toBe('phone');
    expect(byEl(location)?.kind).toBe('cityAndRegion');
  });

  it('maps the work authorization radios to their profile answers', () => {
    const auth = fieldLabelled(fields, 'U.S. Work Authorization');
    expect(auth?.kind).toBe('authorizedToWorkInUS');
    expect(auth?.el.id).toBe('q2-yes');
    expect(fieldLabelled(fields, 'Will you require sponsorship')?.kind).toBe(
      'requiresSponsorship',
    );
  });

  it('leaves the long-text question for Suggest and the model', () => {
    const essay = fieldLabelled(fields, 'Tell us about a robot');
    expect(essay?.kind).toBe('openEnded');
    expect(essay?.el).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('reads the EEO dropdowns as menu buttons', () => {
    expect(fieldLabelled(fields, 'Gender')).toMatchObject({ kind: 'gender', widget: 'menuButton' });
    expect(fieldLabelled(fields, 'Race')).toMatchObject({ kind: 'race', widget: 'menuButton' });
    expect(fieldLabelled(fields, 'Veteran status')).toMatchObject({
      kind: 'veteranStatus',
      widget: 'menuButton',
    });
  });

  it('ignores the description toggles and the submit buttons', () => {
    const buttonTexts = fields
      .filter((f) => f.el instanceof HTMLButtonElement)
      .map((f) => f.el.textContent?.trim());
    expect(buttonTexts).toEqual(['Please select', 'Please select', 'Please select']);
  });
});

describe('gem adapter — detectAll() unclassified questions', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
  });

  it('hands the export control radios and the clearance checkboxes to the model with their options', () => {
    const { unclassified } = gemAdapter.detectAll!(document);
    expect(unclassified).toHaveLength(2);
    const [exportControl, clearance] = unclassified;
    expect(exportControl).toMatchObject({ fieldType: 'radio' });
    expect(exportControl?.label).toMatch(/^This role involves technology subject to U\.S\. export controls/);
    expect(exportControl?.options).toEqual([
      'A lawful permanent resident of the United States',
      'A United States citizen or national',
      'None of the above',
    ]);
    expect(clearance).toMatchObject({ fieldType: 'checkbox' });
    expect(clearance?.options).toEqual([
      'Confidential',
      'Secret',
      'Top Secret',
      'N/A - have never held a U.S. security clearance',
    ]);
  });

  it('turns a skipped work authorization radio back into a question with options', () => {
    const auth = fieldLabelled(gemAdapter.detectFields(document), 'U.S. Work Authorization')!;
    expect(unclassifiedFromDetected(auth)).toMatchObject({
      fieldType: 'radio',
      options: ['Yes', 'No'],
    });
  });
});

describe('gem adapter — filling radios and checkboxes without a name', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
  });

  it('picks the matching radio inside the question', () => {
    const auth = fieldLabelled(gemAdapter.detectFields(document), 'U.S. Work Authorization')!;
    expect(fillField(auth, 'No', { forceOverwrite: false }).status).toBe('filled');
    expect(document.querySelector<HTMLInputElement>('#q2-no')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#q3-no')?.checked).toBe(false);
  });

  it('ticks only the chosen checkbox in the clearance question', () => {
    const rep = document.querySelector<HTMLInputElement>('#q4-confidential')!;
    const action = fillCheckboxGroup(rep, ['Secret'], { forceOverwrite: false }, {
      label: 'clearance',
      kind: 'openEnded',
    });
    expect(action.status).toBe('filled');
    const checked = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ).map((b) => b.id);
    expect(checked).toEqual(['q4-secret']);
  });
});

describe('gem adapter — menu button dropdowns', () => {
  let gender: DetectedField;

  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
    mountFloatingMenu(menuButton('Gender'), ['Male', 'Female', 'Decline to self-identify']);
    gender = fieldLabelled(gemAdapter.detectFields(document), 'Gender')!;
  });

  it('opens the menu and clicks the matching item', async () => {
    const action = await fillMenuButton(gender, 'Female', { suppressFlash: true });
    expect(action.status).toBe('filled');
    expect(gender.el.textContent?.trim()).toBe('Female');
    expect(document.querySelector('menu')).toBeNull();
  });

  it('skips a dropdown that already shows an answer', async () => {
    gender.el.firstElementChild!.textContent = 'Male';
    const action = await fillMenuButton(gender, 'Female', { suppressFlash: true });
    expect(action).toMatchObject({ status: 'skipped', note: 'already filled' });
  });

  it('closes the menu when no item matches', async () => {
    const action = await fillMenuButton(gender, 'Nonbinary', { suppressFlash: true });
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/^no option matched/);
    expect(document.querySelector('menu')).toBeNull();
  });

  it('harvests the item texts for the model and closes the menu', async () => {
    expect(await harvestMenuButtonOptions(gender.el)).toEqual([
      'Male',
      'Female',
      'Decline to self-identify',
    ]);
    expect(document.querySelector('menu')).toBeNull();
  });
});

describe('gem adapter — resume, job description and confirmation', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
  });

  it('attaches the resume to the Resume dropzone, not the cover letter one', async () => {
    const file = new File([new Uint8Array([7, 7])], 'cv.pdf', { type: 'application/pdf' });
    expect(await gemAdapter.fillResume!(file, document)).toBe(true);
    const [resume, coverLetter] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    expect(resume?.files?.[0]?.name).toBe('cv.pdf');
    expect(coverLetter?.files?.length ?? 0).toBe(0);
  });

  it('reads the posting body without the form', () => {
    const jd = gemAdapter.getJobDescription(document);
    expect(jd).toContain('Own the trajectory planner');
    expect(jd).not.toContain('Ready to apply?');
  });

  it('is not confirmed while the form is on the page', () => {
    expect(gemAdapter.detectSubmissionConfirmed!(document, new URL(POSTING_URL))).toBe(false);
  });

  it('is confirmed by the received banner Gem shows after Apply', () => {
    document.body.innerHTML =
      '<div><div style="font-weight: 700">Your application for Robotics Software Engineer has been received!</div></div>';
    expect(gemAdapter.detectSubmissionConfirmed!(document, new URL(POSTING_URL))).toBe(true);
  });
});

describe('gem adapter — URL helpers', () => {
  it('treats jobs.gem.com frames as ATS frames', () => {
    expect(isAtsFrameUrl(POSTING_URL)).toBe(true);
    expect(isAtsFrameUrl('https://www.gem.com/blog')).toBe(false);
  });

  it('keys the resume choice by board, since every Gem customer shares the host', () => {
    expect(companyKeyFromUrl(POSTING_URL)).toBe('jobs.gem.com/globex');
  });

  it('reads the company from the board slug and the role from og:title', () => {
    document.documentElement.innerHTML = loadFixture('gem-form.html');
    const ctx = extractJobContext(document, new URL(POSTING_URL));
    expect(ctx.company).toBe('Globex');
    expect(ctx.role).toBe('Robotics Software Engineer');
  });
});
