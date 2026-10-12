import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workdayAdapter } from '@/adapters/workday';
import { assignHistoryGroups } from '@/adapters/history-groups';
import { valueForField } from '@/content/mapping';
import { fillDetectedField } from '@/content/filler';
import { addHistoryPanels } from '@/content/history-rebuild';
import { emptyEducation, emptyExperience, emptyProfile } from '@/profile/schema';
import type { DetectedField } from '@/adapters/types';
import type { Profile } from '@/profile/schema';

const PROFILE: Profile = {
  ...emptyProfile(),
  experience: [
    {
      ...emptyExperience(),
      jobTitle: 'Staff Engineer',
      employer: 'Stripe',
      location: 'Toronto, ON',
      startDate: '2022-03',
      current: true,
      description: 'Led the payments ledger migration.',
    },
    {
      ...emptyExperience(),
      jobTitle: 'Senior Engineer',
      employer: 'Shopify',
      location: 'Ottawa, ON',
      startDate: '2019-07',
      endDate: '2022-02',
    },
  ],
  education: [
    {
      ...emptyEducation(),
      school: 'University of Waterloo',
      degree: "Bachelor's Degree",
      fieldOfStudy: 'Computer Science',
    },
  ],
};

const DEGREES = ['Select One', 'Associates', 'Bachelors', 'Doctorate', 'HS Diploma', 'Masters', 'MBA', 'Other'];

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/workday-my-experience-live.html'),
    'utf8',
  );
}

function stubAddAnother(sectionId: string, panelPrefix: string, counters: number[]): () => number {
  const section = document.querySelector<HTMLElement>(`[aria-labelledby="${sectionId}"]`)!;
  const template = section.querySelector<HTMLElement>('[aria-labelledby$="-panel"]')!;
  const from = /(workExperience|education)-(\d+)--/.exec(template.innerHTML)![0];
  let clicks = 0;
  section.querySelector('[data-automation-id="add-button"]')!.addEventListener('click', () => {
    clicks++;
    const position = section.querySelectorAll('[aria-labelledby$="-panel"]').length + 1;
    const counter = counters.shift()!;
    const panel = template.cloneNode(true) as HTMLElement;
    panel.innerHTML = panel.innerHTML
      .replaceAll(from, from.replace(/\d+/, String(counter)))
      .replaceAll(`${panelPrefix}-1-panel`, `${panelPrefix}-${position}-panel`);
    panel.setAttribute('aria-labelledby', `${panelPrefix}-${position}-panel`);
    for (const input of Array.from(panel.querySelectorAll('input'))) input.value = '';
    section.insertBefore(panel, section.querySelector('[data-automation-id="add-button"]'));
  });
  return () => clicks;
}

function detect(): DetectedField[] {
  return assignHistoryGroups(workdayAdapter.detectFields(document));
}

function field(fields: DetectedField[], id: string): DetectedField {
  const found = fields.find((f) => f.el.id === id);
  if (!found) throw new Error(`no detected field "${id}"`);
  return found;
}

function value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

describe('workday My Experience page (inline panels)', () => {
  beforeEach(() => {
    loadFixture();
  });

  it('reads each control off its wrapper name and hands pickers to their widgets', () => {
    const fields = detect();
    const kinds = (id: string) => [field(fields, id).kind, field(fields, id).widget ?? 'native'];
    expect(kinds('workExperience-8--jobTitle')).toEqual(['jobTitle', 'native']);
    expect(kinds('workExperience-8--companyName')).toEqual(['employer', 'native']);
    expect(kinds('workExperience-8--location')).toEqual(['employerLocation', 'native']);
    expect(kinds('workExperience-8--currentlyWorkHere')).toEqual(['currentlyEmployed', 'native']);
    expect(kinds('workExperience-8--roleDescription')).toEqual(['roleDescription', 'native']);
    expect(kinds('education-9--school')).toEqual(['school', 'searchPrompt']);
    expect(kinds('education-9--degree')).toEqual(['degree', 'virtualizedDropdown']);
    expect(kinds('education-9--fieldOfStudy')).toEqual(['fieldOfStudy', 'searchPrompt']);
    expect(kinds('socialNetworkAccounts--linkedInAccount')).toEqual(['linkedin', 'native']);
    expect(fields.find((f) => f.el.id === 'skills--skills')).toBeUndefined();
  });

  it('adds a Work Experience panel for the second saved job and none for one school', async () => {
    const workClicks = stubAddAnother('Work-Experience-section', 'Work-Experience', [65]);
    const schoolClicks = stubAddAnother('Education-section', 'Education', [66]);

    const outcomes = await addHistoryPanels(document, workdayAdapter.historyPanels!, PROFILE);

    expect(outcomes).toEqual([]);
    expect(workClicks()).toBe(1);
    expect(schoolClicks()).toBe(0);
    expect(workdayAdapter.historyPanels!.panels(document, 'experience')).toHaveLength(2);
  });

  it('numbers panels by position, not by the counter in the control ids', async () => {
    stubAddAnother('Work-Experience-section', 'Work-Experience', [5]);
    await addHistoryPanels(document, workdayAdapter.historyPanels!, PROFILE);
    const fields = detect();

    expect(field(fields, 'workExperience-8--jobTitle').group).toEqual({ kind: 'experience', index: 0 });
    expect(field(fields, 'workExperience-5--jobTitle').group).toEqual({ kind: 'experience', index: 1 });
    expect(field(fields, 'workExperience-5--startDate-dateSectionMonth-input').group).toEqual({
      kind: 'experience',
      index: 1,
    });
    expect(field(fields, 'education-9--school').group).toEqual({ kind: 'education', index: 0 });
  });

  it('fills each saved job into its own panel', async () => {
    stubAddAnother('Work-Experience-section', 'Work-Experience', [65]);
    await addHistoryPanels(document, workdayAdapter.historyPanels!, PROFILE);
    for (const f of detect().filter((d) => !d.widget)) {
      await fillDetectedField(f, valueForField(PROFILE, f.kind, f.label, f.group), {
        forceOverwrite: false,
        suppressFlash: true,
      });
    }

    expect(value('workExperience-8--jobTitle')).toBe('Staff Engineer');
    expect(value('workExperience-8--companyName')).toBe('Stripe');
    expect(value('workExperience-8--location')).toBe('Toronto, ON');
    expect((document.getElementById('workExperience-8--currentlyWorkHere') as HTMLInputElement).checked).toBe(true);
    expect(value('workExperience-8--startDate-dateSectionMonth-input')).toBe('03');
    expect(value('workExperience-8--startDate-dateSectionYear-input')).toBe('2022');
    expect(value('workExperience-8--endDate-dateSectionMonth-input')).toBe('');

    expect(value('workExperience-65--jobTitle')).toBe('Senior Engineer');
    expect(value('workExperience-65--companyName')).toBe('Shopify');
    expect(value('workExperience-65--startDate-dateSectionMonth-input')).toBe('07');
    expect(value('workExperience-65--endDate-dateSectionYear-input')).toBe('2022');
  });

  it('writes the year before the month, since Workday clears a month typed into a date with no year', () => {
    const ids = detect().map((f) => f.el.id);
    const year = ids.indexOf('workExperience-8--startDate-dateSectionYear-input');
    const month = ids.indexOf('workExperience-8--startDate-dateSectionMonth-input');
    expect(year).toBeGreaterThan(-1);
    expect(year).toBeLessThan(month);
  });

  it('answers the first Languages panel with English, fluent, and Fluent proficiency', () => {
    const answers = workdayAdapter.siteAnswers!(document).map((a) => [a.field.el.id, a.answer([])]);
    expect(answers).toEqual([
      ['language-10--language', 'English'],
      ['language-10--native', true],
      ['language-10--3e82bdec28fd01a409e3cf270f110316', 'Fluent'],
    ]);
  });

  it('leaves a Languages panel alone once a language is picked', () => {
    document.getElementById('language-10--language')!.textContent = 'Spanish';
    expect(workdayAdapter.siteAnswers!(document)).toEqual([]);
  });

  it('keeps the Languages panel and Skills away from the AI fallback', () => {
    const ids = workdayAdapter.detectAll!(document).unclassified.map((u) => u.el.id);
    expect(ids).not.toContain('language-10--language');
    expect(ids).not.toContain('language-10--native');
    expect(ids).not.toContain('language-10--3e82bdec28fd01a409e3cf270f110316');
    expect(ids).not.toContain('skills--skills');
  });

  it("picks Workday's Bachelors option for a Bachelor's Degree", async () => {
    const button = document.getElementById('education-9--degree')!;
    button.addEventListener('click', () => {
      if (document.getElementById('degree-options')) return;
      const list = document.createElement('ul');
      list.id = 'degree-options';
      list.setAttribute('role', 'listbox');
      for (const name of DEGREES) {
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
    const degree = field(detect(), 'education-9--degree');

    const action = await fillDetectedField(
      degree,
      valueForField(PROFILE, degree.kind, degree.label, degree.group),
      { forceOverwrite: false, suppressFlash: true },
    );

    expect(action.status).toBe('filled');
    expect(button.textContent).toBe('Bachelors');
  });
});
