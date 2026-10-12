import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workdayAdapter } from '@/adapters/workday';
import { valueForField } from '@/content/mapping';
import { fillDetectedField, fillSiteAnswer } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';

const PROFILE: Profile = {
  ...emptyProfile(),
  workAuth: {
    ...emptyProfile().workAuth,
    authorizedToWorkInUS: true,
    requiresSponsorship: false,
    willingToRelocate: false,
    desiredSalary: '185000',
  },
};

const YES_NO = ['Yes', 'No'];

const OPTIONS: Record<string, string[]> = {
  a001: [
    'Current Associate with Globex',
    'Current Associate with a subsidiary of Globex',
    'Former Associate of Globex, or subsidiary',
    'Not Applicable',
  ],
  a002: ['E-mail', 'Home Phone', 'Cell Phone'],
  a00b: ['I consent', 'I do not consent'],
};

function buttonId(suffix: string): string {
  return `primaryQuestionnaire--a1c0000000000000000000000000${suffix}`;
}

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/workday-application-questions.html'),
    'utf8',
  );
}

function installListboxes(): void {
  for (const button of Array.from(
    document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]'),
  )) {
    const options = OPTIONS[button.id.slice(-4)] ?? YES_NO;
    button.addEventListener('click', () => {
      const open = document.getElementById(`${button.id}-options`);
      if (open) {
        open.remove();
        return;
      }
      const list = document.createElement('ul');
      list.id = `${button.id}-options`;
      list.setAttribute('role', 'listbox');
      list.setAttribute('data-test-listbox', '');
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

function text(suffix: string): string {
  return (document.getElementById(buttonId(suffix))!.textContent ?? '').trim();
}

describe('workday Application Questions page', () => {
  beforeEach(() => {
    loadFixture();
  });

  it('classifies the profile-backed questions by their label', () => {
    const kinds = Object.fromEntries(
      workdayAdapter.detectFields(document).map((f) => [f.el.id.slice(-4), [f.kind, f.widget ?? 'native']]),
    );
    expect(kinds).toEqual({
      a003: ['desiredSalary', 'native'],
      a004: ['authorizedToWorkInUS', 'virtualizedDropdown'],
      a005: ['requiresSponsorship', 'virtualizedDropdown'],
      a006: ['willingToRelocate', 'virtualizedDropdown'],
    });
  });

  it('picks each default from the options the question actually offers', () => {
    const picks = Object.fromEntries(
      workdayAdapter
        .siteAnswers!(document)
        .map((a) => [a.field.el.id.slice(-4), a.answer(OPTIONS[a.field.el.id.slice(-4)] ?? YES_NO)]),
    );
    expect(picks).toEqual({
      a002: 'E-mail',
      a007: 'Yes',
      a008: 'Yes',
      a00b: 'I do not consent',
    });
  });

  it('keeps the defaulted questions away from the AI fallback', () => {
    const ids = workdayAdapter.detectAll!(document).unclassified.map((u) => u.el.id.slice(-4));
    for (const id of ['a002', 'a007', 'a008', 'a00b']) {
      expect(ids).not.toContain(id);
    }
  });

  it('leaves the questions that depend on work history and education to the AI fallback', () => {
    const questions = new Map(
      workdayAdapter.detectAll!(document).unclassified.map((u) => [u.el.id.slice(-4), u]),
    );
    expect(questions.get('a001')).toMatchObject({
      fieldType: 'combobox',
      label: expect.stringMatching(/^Are you currently, or have you previously been employed/),
    });
    expect(questions.get('a009')).toMatchObject({
      fieldType: 'combobox',
      label: expect.stringMatching(/^Based on the job description, do you have the required/),
    });
    expect(questions.get('a00a')).toMatchObject({
      fieldType: 'combobox',
      label: expect.stringMatching(/^Do you meet the educational requirement/),
    });
  });

  it('fills the whole page from the profile and the defaults', async () => {
    installListboxes();
    const opts = { forceOverwrite: false, suppressFlash: true };
    for (const answer of workdayAdapter.siteAnswers!(document)) {
      await fillSiteAnswer(answer, opts);
    }
    for (const field of workdayAdapter.detectFields(document)) {
      await fillDetectedField(field, valueForField(PROFILE, field.kind, field.label), opts);
    }

    expect(text('a001')).toBe('Select One');
    expect(text('a002')).toBe('E-mail');
    expect((document.getElementById(buttonId('a003')) as HTMLInputElement).value).toBe('185000');
    expect(text('a004')).toBe('Yes');
    expect(text('a005')).toBe('No');
    expect(text('a006')).toBe('No');
    expect(text('a007')).toBe('Yes');
    expect(text('a00b')).toBe('I do not consent');
  });

  it('opens each dropdown once, since Workday ignores Escape and a second click closes it', async () => {
    installListboxes();
    let opens = 0;
    const button = document.getElementById(buttonId('a00b'))!;
    button.addEventListener('click', () => opens++);
    const sms = workdayAdapter.siteAnswers!(document).find((a) => a.field.el === button)!;

    const action = await fillSiteAnswer(sms, { forceOverwrite: false, suppressFlash: true });

    expect(action).toMatchObject({ status: 'filled', note: 'picked "I do not consent"' });
    expect(opens).toBe(1);
  });

  it('leaves a question alone once it has an answer', () => {
    document.getElementById(buttonId('a007'))!.textContent = 'No';
    const ids = workdayAdapter.siteAnswers!(document).map((a) => a.field.el.id.slice(-4));
    expect(ids).not.toContain('a007');
  });
});
