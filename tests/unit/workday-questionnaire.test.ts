import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workdayAdapter } from '@/adapters/workday';
import { isRequiredField } from '@/adapters/_shared';
import { valueForField } from '@/content/mapping';
import { fillSiteAnswer } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';

const PROFILE: Profile = {
  ...emptyProfile(),
  workAuth: {
    ...emptyProfile().workAuth,
    authorizedToWorkInUS: true,
    requiresSponsorship: false,
  },
};

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/workday-questionnaire-rich-labels.html'),
    'utf8',
  );
}

function suffix(el: HTMLElement): string {
  return el.id.slice(-4);
}

function dateInput(part: 'Month' | 'Day' | 'Year'): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`[data-automation-id="dateSection${part}-input"]`)!;
}

describe('workday Application Questions with rich-text legends', () => {
  beforeEach(() => {
    loadFixture();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the profile-backed questions off their legends, so the step has fields to fill', () => {
    const kinds = Object.fromEntries(
      workdayAdapter.detectFields(document).map((f) => [suffix(f.el), f.kind]),
    );
    expect(kinds).toEqual({
      '0000': 'authorizedToWorkInUS',
      '0a01': 'authorizedToWorkInUS',
      '0001': 'requiresSponsorship',
      '0003': 'willingToRelocate',
    });
  });

  it('does not answer the spouse-of-a-visa-holder follow-up from the authorized-to-work toggle', () => {
    const fields = workdayAdapter.detectFields(document);
    const answers = Object.fromEntries(
      fields.map((f) => [suffix(f.el), valueForField(PROFILE, f.kind, f.label)]),
    );
    expect(answers).toEqual({ '0000': 'Yes', '0a01': null, '0001': 'No', '0003': null });
  });

  it('leaves the footnote out of the sponsorship question, so it is answered from the profile', () => {
    const sponsorship = workdayAdapter.detectFields(document).find((f) => suffix(f.el) === '0001')!;
    expect(sponsorship.label).toMatch(/^2\. Will you need Globex to sponsor you/);
    expect(sponsorship.label).not.toContain('Candidates in F1');
    expect(valueForField(PROFILE, sponsorship.kind, sponsorship.label)).toBe('No');
  });

  it('hands the other questions to the AI fallback with their wording instead of "Select One Required"', () => {
    const questions = workdayAdapter.detectAll!(document).unclassified;
    expect(questions.map((q) => [suffix(q.el), q.fieldType])).toEqual([
      ['0002', 'combobox'],
      ['0004', 'combobox'],
      ['0005', 'combobox'],
      ['0006', 'combobox'],
    ]);
    expect(questions.map((q) => q.label)).toEqual([
      expect.stringMatching(/^3\. Did you answer "No" to Question 1/),
      expect.stringMatching(/^This position requires employees to work onsite/),
      expect.stringMatching(/^Can you confirm that you meet the minimum qualification/),
      expect.stringMatching(/^Are you a current or former \(prior 18 months\) employee/),
    ]);
    expect(questions.every((q) => isRequiredField(q.el, q.label))).toBe(true);
  });

  it('does not read the question about earlier answers as a sponsorship question', () => {
    expect(workdayAdapter.detectFields(document).map((f) => suffix(f.el))).not.toContain('0002');
  });

  it("enters today's date into the acknowledgement and keeps the date parts away from the AI fallback", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 12), toFake: ['Date'] });
    const answers = workdayAdapter.siteAnswers!(document);
    expect(answers.map((a) => a.field.el.getAttribute('data-automation-id'))).toEqual([
      'dateSectionMonth-input',
      'dateSectionDay-input',
      'dateSectionYear-input',
    ]);
    for (const answer of answers) {
      await fillSiteAnswer(answer, { forceOverwrite: false, suppressFlash: true });
    }
    expect([dateInput('Month').value, dateInput('Day').value, dateInput('Year').value]).toEqual([
      '10',
      '12',
      '2026',
    ]);
    const unclassified = workdayAdapter.detectAll!(document).unclassified.map((u) => u.el);
    expect(unclassified).not.toContain(dateInput('Month'));
    expect(unclassified).not.toContain(dateInput('Day'));
  });

  it('leaves a date the user already entered alone', async () => {
    dateInput('Day').value = '03';
    const day = workdayAdapter.siteAnswers!(document).find((a) => a.field.el === dateInput('Day'))!;
    const action = await fillSiteAnswer(day, { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'skipped', note: 'already filled' });
    expect(dateInput('Day').value).toBe('03');
  });
});
